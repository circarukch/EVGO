import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ChargingSession, PaymentBlock, Prisma } from "@prisma/client";
import { config } from "../config";
import { PrismaService } from "../prisma/prisma.service";
import { BlockStatus, PAYMENT_GATEWAY, PaymentGateway, PaymentGatewayError } from "../payments/gateway";
import { GATEWAY_CLEARING, lockWallet, operatorPayable, postJournal, USER_WALLET, walletBalance } from "../wallet/ledger";
import { WalletService } from "../wallet/wallet.service";
import { CHARGER_CONTROL, ChargerControl } from "./charger-control";

const sessionInclude = {
  charger: { include: { site: { include: { place: true } }, connectors: { include: { tariff: true } } } },
  paymentBlock: true,
} satisfies Prisma.ChargingSessionInclude;
type SessionRow = Prisma.ChargingSessionGetPayload<{ include: typeof sessionInclude }>;

const costOf = (energyWh: number, perKwhPaise: number) => Math.ceil((energyWh * perKwhPaise) / 1000);

/**
 * Pay-as-you-go charging from the app: start on a connector, watch it live, stop, pay.
 * Two ways to pay: from the EVGO wallet, or with no wallet at all by blocking an amount by UPI
 * (approved in the customer's UPI app), capturing only what was used at Stop and releasing the rest.
 */
@Injectable()
export class ChargingService {
  constructor(
    private readonly db: PrismaService,
    private readonly wallets: WalletService,
    @Inject(CHARGER_CONTROL) private readonly control: ChargerControl,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  private async pay<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof PaymentGatewayError && e.kind === "NOT_CONFIGURED") throw new ServiceUnavailableException(e.message);
      if (e instanceof PaymentGatewayError && e.kind === "DECLINED") throw new HttpException(e.message, HttpStatus.PAYMENT_REQUIRED);
      throw new ServiceUnavailableException("The payment service did not respond. Please try again");
    }
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if ((e as Error).message === "NOT_CONNECTED") throw new ServiceUnavailableException("Charging from the app is not switched on yet");
      throw new ServiceUnavailableException("The charger did not respond. Please try again");
    }
  }

  /** The charger and connector a user may start on now, or the reason they cannot. */
  private async startable(userId: string, chargePointId: string, connectorId: number) {
    if (!chargePointId || !Number.isInteger(connectorId)) throw new BadRequestException("chargePointId and connectorId are required");
    const charger = await this.db.charger.findUnique({
      where: { chargePointId },
      include: { site: { include: { place: true } }, connectors: { include: { tariff: true } } },
    });
    const connector = charger?.connectors.find((c) => c.ocppId === connectorId);
    if (!charger || !connector) throw new NotFoundException("Charger not found. Check the code on the charger");
    if (charger.site.access !== "public") throw new ForbiddenException("This charger is for fleet vehicles only");
    if (!connector.tariff) throw new ConflictException("This charger has no price set yet");
    if (connector.status === "Faulted" || connector.status === "Unavailable") throw new ConflictException("This connector is out of service");
    if (await this.db.chargingSession.findFirst({ where: { userId, status: "ACTIVE" } })) {
      throw new ConflictException("You already have a charging session running");
    }
    return { charger, connector, tariff: connector.tariff };
  }

  /** Pay from the wallet: needs ₹100 in it, and stops before using more than the balance. */
  async start(userId: string, chargePointId: string, connectorId: number) {
    const { charger, connector, tariff } = await this.startable(userId, chargePointId, connectorId);
    const wallet = await this.wallets.walletFor(userId);
    const balance = await this.db.$transaction((tx) => walletBalance(tx, wallet.id));
    if (balance < config.chargingMinStartPaise) {
      throw new HttpException(
        {
          message: `Keep at least ₹${config.chargingMinStartPaise / 100} in your wallet to start charging`,
          balancePaise: balance,
          shortfallPaise: config.chargingMinStartPaise - balance,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    const id = await this.launch(userId, charger, connector, tariff.perKwhPaise, balance, null);
    return this.view(userId, id);
  }

  /** Claim the connector, start the charger, record the session. Releases the connector if anything fails. */
  private async launch(
    userId: string,
    charger: { id: string; chargePointId: string },
    connector: { id: string; ocppId: number; status: string; maxPowerKw: Prisma.Decimal | number },
    perKwhPaise: number,
    maxCostPaise: number,
    paymentBlockId: string | null,
  ): Promise<string> {
    // Claim the connector first, so two people cannot start on it at once.
    const claimed = await this.db.connector.updateMany({ where: { id: connector.id, status: "Available" }, data: { status: "Charging" } });
    if (claimed.count !== 1) {
      throw new ConflictException(connector.status === "Faulted" ? "This connector is out of service" : "This connector is busy");
    }
    try {
      const idTag = `APP-${userId.slice(0, 12)}`;
      const started = await this.call(() =>
        this.control.start({ chargePointId: charger.chargePointId, connectorId: connector.ocppId, idTag, maxPowerKw: Number(connector.maxPowerKw) }),
      );
      const session = await this.db.chargingSession.create({
        data: {
          chargerId: charger.id,
          connectorOcppId: connector.ocppId,
          ocppTransactionId: started.transactionId,
          idTag,
          userId,
          perKwhPaise,
          maxCostPaise,
          paymentBlockId,
          meterStartWh: started.meterStartWh,
          startedAt: new Date(),
        },
      });
      return session.id;
    } catch (e) {
      await this.db.connector.update({ where: { id: connector.id }, data: { status: "Available" } });
      throw e;
    }
  }

  // ---------- Paying by UPI, no wallet ----------

  /** Step 1: ask the customer's bank, through their UPI app, to block an amount for this session. */
  async createUpiBlock(userId: string, chargePointId: string, connectorId: number, amountPaise: number) {
    if (!Number.isInteger(amountPaise) || amountPaise < config.chargingMinStartPaise || amountPaise > config.upiBlockMaxPaise) {
      throw new BadRequestException(
        `Choose an amount between ₹${config.chargingMinStartPaise / 100} and ₹${(config.upiBlockMaxPaise / 100).toLocaleString("en-IN")}`,
      );
    }
    const { charger, connector } = await this.startable(userId, chargePointId, connectorId);
    if (connector.status !== "Available") throw new ConflictException("This connector is busy");
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    const now = Date.now();
    const block = await this.db.paymentBlock.create({
      data: {
        userId,
        gateway: this.gateway.name,
        purpose: "charging",
        amountPaise,
        meta: { chargePointId, connectorId },
        approveBy: new Date(now + config.upiApproveMinutes * 60_000),
        expiresAt: new Date(now + config.upiBlockValidHours * 3_600_000),
      },
    });
    const created = await this.pay(() =>
      this.gateway.createBlock({
        ref: `evgo_${block.id.replace(/-/g, "")}`,
        amountPaise,
        description: `EV charging at ${charger.site.place.name}`,
        customerId: userId,
        customerPhone: user.phone,
        approveBy: block.approveBy,
        expiresAt: block.expiresAt,
      }),
    );
    const saved = await this.db.paymentBlock.update({ where: { id: block.id }, data: { gatewayRef: created.gatewayRef } });
    return this.presentBlock(saved, created.upiIntentUrl);
  }

  /** Development stand-in for the customer approving (or declining) in their UPI app. */
  async mockUpiDecision(userId: string, blockId: string, approve: boolean) {
    const g = this.gateway as PaymentGateway & { approve?: (ref: string) => void; decline?: (ref: string) => void };
    if (!config.mockPayments || g.name !== "mock" || !g.approve || !g.decline) throw new NotFoundException();
    const block = await this.loadBlock(userId, blockId);
    if (approve) g.approve(block.gatewayRef!);
    else g.decline(block.gatewayRef!);
    return this.refreshBlock(block).then((b) => this.presentBlock(b));
  }

  /** Bring a waiting block up to date with the gateway (the gateway is the source of truth). */
  private async refreshBlock(block: PaymentBlock): Promise<PaymentBlock> {
    if (block.status !== "PENDING") return block;
    const at: BlockStatus = await this.pay(() => this.gateway.blockStatus(block.gatewayRef!));
    const next = at === "PENDING" && Date.now() > block.approveBy.getTime() ? "EXPIRED" : at;
    if (next === "PENDING") return block;
    await this.db.paymentBlock.updateMany({ where: { id: block.id, status: "PENDING" }, data: { status: next } });
    return this.db.paymentBlock.findUniqueOrThrow({ where: { id: block.id } });
  }

  /**
   * Step 2, called by the app after the customer approves (and safe to call repeatedly):
   * while the approval is pending, says so; once the money is blocked, starts the charger.
   */
  async startWithUpiBlock(userId: string, blockId: string) {
    const block = await this.refreshBlock(await this.loadBlock(userId, blockId));
    if (block.status === "PENDING") return { block: this.presentBlock(block), session: null };
    if (block.status === "IN_USE" || block.status === "CAPTURED" || block.status === "RELEASED") {
      const s = await this.db.chargingSession.findUnique({ where: { paymentBlockId: block.id } });
      if (s) return { block: this.presentBlock(block), session: await this.view(userId, s.id) };
    }
    if (block.status !== "AUTHORIZED") {
      throw new HttpException(
        { message: block.status === "EXPIRED" ? "The UPI request expired. Please try again" : "The payment was not approved in your UPI app", block: this.presentBlock(block) },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    // Only one caller gets to start on this block.
    const claimed = await this.db.paymentBlock.updateMany({ where: { id: block.id, status: "AUTHORIZED" }, data: { status: "IN_USE" } });
    if (claimed.count !== 1) throw new ConflictException("Charging is already starting on this payment");
    const { chargePointId, connectorId } = block.meta as { chargePointId: string; connectorId: number };
    try {
      const { charger, connector, tariff } = await this.startable(userId, chargePointId, connectorId);
      const id = await this.launch(userId, charger, connector, tariff.perKwhPaise, block.amountPaise, block.id);
      const done = await this.db.paymentBlock.findUniqueOrThrow({ where: { id: block.id } });
      return { block: this.presentBlock(done), session: await this.view(userId, id) };
    } catch (e) {
      // The charger could not start: nothing is owed, so give the whole amount back now.
      await this.releaseBlock(block);
      throw e;
    }
  }

  /** The customer gives up before charging starts: release whatever was blocked. */
  async cancelUpiBlock(userId: string, blockId: string) {
    const block = await this.refreshBlock(await this.loadBlock(userId, blockId));
    if (block.status === "IN_USE" || block.status === "CAPTURED") throw new ConflictException("Charging has already started on this payment");
    if (block.status === "AUTHORIZED") await this.releaseBlock(block);
    else if (block.status === "PENDING") await this.db.paymentBlock.updateMany({ where: { id: block.id, status: "PENDING" }, data: { status: "EXPIRED" } });
    return this.presentBlock(await this.db.paymentBlock.findUniqueOrThrow({ where: { id: block.id } }));
  }

  private async releaseBlock(block: PaymentBlock) {
    try {
      await this.gateway.release(block.gatewayRef!);
      await this.db.paymentBlock.update({ where: { id: block.id }, data: { status: "RELEASED" } });
    } catch {
      // The bank releases an unused block by itself at expiresAt; ops can see these in CAPTURE_FAILED.
      await this.db.paymentBlock.update({ where: { id: block.id }, data: { status: "CAPTURE_FAILED" } });
    }
  }

  private async loadBlock(userId: string, id: string): Promise<PaymentBlock> {
    const b = await this.db.paymentBlock.findUnique({ where: { id } });
    if (!b) throw new NotFoundException("Payment not found");
    if (b.userId !== userId) throw new ForbiddenException();
    return b;
  }

  private presentBlock(b: PaymentBlock, upiIntentUrl?: string) {
    return {
      id: b.id,
      status: b.status,
      gateway: b.gateway,
      amountPaise: b.amountPaise,
      capturedPaise: b.capturedPaise,
      approveBy: b.approveBy,
      ...(upiIntentUrl ? { upiIntentUrl } : {}),
    };
  }

  async active(userId: string) {
    const s = await this.db.chargingSession.findFirst({ where: { userId, status: "ACTIVE" } });
    return { session: s ? await this.view(userId, s.id) : null };
  }

  /** Live view; stops the session by itself once it has used the wallet balance it started with. */
  async view(userId: string, id: string): Promise<ReturnType<ChargingService["present"]>> {
    const s = await this.load(userId, id);
    if (s.status === "STOPPED") return this.present(s, s.energyWh ?? 0, 0);
    const { meterWh, powerKw } = await this.call(() => this.control.meter(s.charger.chargePointId, s.ocppTransactionId));
    const energyWh = Math.max(0, meterWh - s.meterStartWh);
    if (s.maxCostPaise !== null && costOf(energyWh, s.perKwhPaise) >= s.maxCostPaise) {
      return this.stop(userId, id, s.paymentBlockId ? "AmountLimit" : "WalletLimit");
    }
    return this.present(s, energyWh, powerKw);
  }

  async stop(userId: string, id: string, reason = "StoppedInApp") {
    const s = await this.load(userId, id);
    const claimed = await this.db.chargingSession.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "STOPPED", stoppedAt: new Date(), stopReason: reason } });
    if (claimed.count !== 1) throw new ConflictException("This session has already stopped");
    let meterStopWh: number;
    try {
      ({ meterStopWh } = await this.call(() => this.control.stop(s.charger.chargePointId, s.ocppTransactionId)));
    } catch (e) {
      await this.db.chargingSession.update({ where: { id }, data: { status: "ACTIVE", stoppedAt: null, stopReason: null } });
      throw e;
    }
    const energyWh = Math.max(0, meterStopWh - s.meterStartWh);
    if (s.paymentBlock) return this.settleUpi(userId, s, meterStopWh, energyWh);
    const wallet = await this.wallets.walletFor(userId);
    const site = s.charger.site;

    await this.db.$transaction(async (tx) => {
      await lockWallet(tx, wallet.id);
      const balance = await walletBalance(tx, wallet.id);
      // Never take the wallet below zero; a shortfall would be the operator's loss, which the auto-stop keeps small.
      const costPaise = Math.min(costOf(energyWh, s.perKwhPaise), balance);
      const order = await tx.order.create({ data: { userId, totalPaise: costPaise, status: "PAID" } });
      const item = await tx.orderItem.create({
        data: { orderId: order.id, type: "CHARGING_SESSION", amountPaise: costPaise, meta: { chargePointId: s.charger.chargePointId, energyWh } },
      });
      if (costPaise > 0) {
        await postJournal(tx, [
          { account: USER_WALLET, walletId: wallet.id, debitPaise: costPaise, memo: `Charging, ${site.place.name}` },
          { account: operatorPayable(site.orgId), creditPaise: costPaise, memo: `Charging session ${id}` },
        ]);
        await tx.payment.create({ data: { orderId: order.id, method: "wallet", amountPaise: costPaise, status: "SUCCEEDED" } });
      }
      await tx.chargingSession.update({ where: { id }, data: { meterStopWh, energyWh, costPaise, orderItemId: item.id } });
      await tx.connector.updateMany({ where: { chargerId: s.chargerId, ocppId: s.connectorOcppId }, data: { status: "Available" } });
    });
    const done = await this.load(userId, id);
    return { ...this.present(done, energyWh, 0), balancePaise: await this.db.$transaction((tx) => walletBalance(tx, wallet.id)) };
  }

  /** UPI session: take the used amount from the block (the bank releases the rest), or release it all if nothing was used. */
  private async settleUpi(userId: string, s: SessionRow, meterStopWh: number, energyWh: number) {
    const block = s.paymentBlock!;
    const site = s.charger.site;
    const costPaise = Math.min(costOf(energyWh, s.perKwhPaise), block.amountPaise);
    let captured = false;
    let captureRef: string | undefined;
    if (costPaise > 0) {
      try {
        ({ captureRef } = await this.gateway.capture(block.gatewayRef!, costPaise));
        captured = true;
      } catch {
        // Charging has happened; record what is owed and let ops retry the capture.
      }
    } else {
      await this.releaseBlock(block);
    }
    await this.db.$transaction(async (tx) => {
      const order = await tx.order.create({ data: { userId, totalPaise: costPaise, status: captured || costPaise === 0 ? "PAID" : "PENDING" } });
      const item = await tx.orderItem.create({
        data: { orderId: order.id, type: "CHARGING_SESSION", amountPaise: costPaise, meta: { chargePointId: s.charger.chargePointId, energyWh } },
      });
      if (costPaise > 0) {
        await tx.payment.create({
          data: { orderId: order.id, method: "upi", gatewayRef: captureRef ?? block.gatewayRef, amountPaise: costPaise, status: captured ? "SUCCEEDED" : "PENDING" },
        });
        if (captured) {
          await postJournal(tx, [
            { account: GATEWAY_CLEARING, debitPaise: costPaise, memo: `UPI capture ${block.gatewayRef}` },
            { account: operatorPayable(site.orgId), creditPaise: costPaise, memo: `Charging session ${s.id}` },
          ]);
        }
        await tx.paymentBlock.update({
          where: { id: block.id },
          data: { status: captured ? "CAPTURED" : "CAPTURE_FAILED", capturedPaise: captured ? costPaise : 0 },
        });
      }
      await tx.chargingSession.update({ where: { id: s.id }, data: { meterStopWh, energyWh, costPaise, orderItemId: item.id } });
      await tx.connector.updateMany({ where: { chargerId: s.chargerId, ocppId: s.connectorOcppId }, data: { status: "Available" } });
    });
    return this.present(await this.load(userId, s.id), energyWh, 0);
  }

  private async load(userId: string, id: string): Promise<SessionRow> {
    const s = await this.db.chargingSession.findUnique({ where: { id }, include: sessionInclude });
    if (!s) throw new NotFoundException("Charging session not found");
    if (s.userId !== userId) throw new ForbiddenException();
    return s;
  }

  private present(s: SessionRow | (ChargingSession & SessionRow), energyWh: number, powerKw: number) {
    const connector = s.charger.connectors.find((c) => c.ocppId === s.connectorOcppId);
    return {
      id: s.id,
      status: s.status,
      chargePointId: s.charger.chargePointId,
      connectorId: s.connectorOcppId,
      connectorType: connector?.type,
      placeName: s.charger.site.place.name,
      perKwhInr: s.perKwhPaise / 100,
      startedAt: s.startedAt,
      stoppedAt: s.stoppedAt,
      stopReason: s.stopReason,
      energyKwh: Math.round(energyWh) / 1000,
      powerKw: Math.round(powerKw * 10) / 10,
      costPaise: s.status === "STOPPED" && s.costPaise !== null ? s.costPaise : costOf(energyWh, s.perKwhPaise),
      maxCostPaise: s.maxCostPaise,
      payment: s.paymentBlock
        ? {
            method: "upi" as const,
            blockedPaise: s.paymentBlock.amountPaise,
            capturedPaise: s.paymentBlock.capturedPaise,
            status: s.paymentBlock.status,
            // What goes back to the customer's bank once the session is settled.
            releasedPaise: s.status === "STOPPED" && s.paymentBlock.status !== "CAPTURE_FAILED" ? s.paymentBlock.amountPaise - s.paymentBlock.capturedPaise : 0,
          }
        : { method: "wallet" as const },
    };
  }
}
