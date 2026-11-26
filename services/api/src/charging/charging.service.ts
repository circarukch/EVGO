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
import { ChargingSession, Prisma } from "@prisma/client";
import { config } from "../config";
import { PrismaService } from "../prisma/prisma.service";
import { lockWallet, operatorPayable, postJournal, USER_WALLET, walletBalance } from "../wallet/ledger";
import { WalletService } from "../wallet/wallet.service";
import { CHARGER_CONTROL, ChargerControl } from "./charger-control";

const sessionInclude = {
  charger: { include: { site: { include: { place: true } }, connectors: { include: { tariff: true } } } },
} satisfies Prisma.ChargingSessionInclude;
type SessionRow = Prisma.ChargingSessionGetPayload<{ include: typeof sessionInclude }>;

const costOf = (energyWh: number, perKwhPaise: number) => Math.ceil((energyWh * perKwhPaise) / 1000);

/** Pay-as-you-go charging from the app: start on a connector, watch it live, stop, pay from the wallet. */
@Injectable()
export class ChargingService {
  constructor(
    private readonly db: PrismaService,
    private readonly wallets: WalletService,
    @Inject(CHARGER_CONTROL) private readonly control: ChargerControl,
  ) {}

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if ((e as Error).message === "NOT_CONNECTED") throw new ServiceUnavailableException("Charging from the app is not switched on yet");
      throw new ServiceUnavailableException("The charger did not respond. Please try again");
    }
  }

  async start(userId: string, chargePointId: string, connectorId: number) {
    if (!chargePointId || !Number.isInteger(connectorId)) throw new BadRequestException("chargePointId and connectorId are required");
    const charger = await this.db.charger.findUnique({
      where: { chargePointId },
      include: { site: true, connectors: { include: { tariff: true } } },
    });
    const connector = charger?.connectors.find((c) => c.ocppId === connectorId);
    if (!charger || !connector) throw new NotFoundException("Charger not found. Check the code on the charger");
    if (charger.site.access !== "public") throw new ForbiddenException("This charger is for fleet vehicles only");
    if (!connector.tariff) throw new ConflictException("This charger has no price set yet");
    if (await this.db.chargingSession.findFirst({ where: { userId, status: "ACTIVE" } })) {
      throw new ConflictException("You already have a charging session running");
    }
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
    // Claim the connector first, so two people cannot start on it at once.
    const claimed = await this.db.connector.updateMany({ where: { id: connector.id, status: "Available" }, data: { status: "Charging" } });
    if (claimed.count !== 1) {
      throw new ConflictException(connector.status === "Faulted" ? "This connector is out of service" : "This connector is busy");
    }
    try {
      const idTag = `APP-${userId.slice(0, 12)}`;
      const started = await this.call(() => this.control.start({ chargePointId, connectorId, idTag, maxPowerKw: Number(connector.maxPowerKw) }));
      const session = await this.db.chargingSession.create({
        data: {
          chargerId: charger.id,
          connectorOcppId: connectorId,
          ocppTransactionId: started.transactionId,
          idTag,
          userId,
          perKwhPaise: connector.tariff.perKwhPaise,
          maxCostPaise: balance,
          meterStartWh: started.meterStartWh,
          startedAt: new Date(),
        },
      });
      return this.view(userId, session.id);
    } catch (e) {
      await this.db.connector.update({ where: { id: connector.id }, data: { status: "Available" } });
      throw e;
    }
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
      return this.stop(userId, id, "WalletLimit");
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
    };
  }
}
