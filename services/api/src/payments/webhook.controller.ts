import { BadRequestException, Controller, Headers, HttpCode, Inject, Logger, Module, Post, Req, UnauthorizedException } from "@nestjs/common";
import { BookingModule } from "../booking/booking.module";
import { BookingService } from "../booking/booking.service";
import { WalletModule } from "../wallet/wallet.module";
import { WalletService } from "../wallet/wallet.service";
import { PAYMENT_GATEWAY, PaymentGateway } from "./gateway";
import { RefundsService } from "./refunds.service";

type CashfreeWebhook = {
  type?: string;
  data?: { order?: { order_id?: string }; refund?: { refund_id?: string; refund_status?: string } };
};

/**
 * Cashfree tells us when a payment or refund finishes, so a customer who closes the app before
 * returning from checkout still gets their tickets or wallet money. The webhook only triggers a
 * check: the status is always read back from Cashfree, never taken from the webhook body.
 */
@Controller("payments")
export class PaymentWebhookController {
  private readonly log = new Logger("PaymentWebhook");
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly wallet: WalletService,
    private readonly bookings: BookingService,
    private readonly refunds: RefundsService,
  ) {}

  @Post("cashfree/webhook")
  @HttpCode(200)
  async cashfree(
    @Req() req: { rawBody?: Buffer },
    @Headers("x-webhook-timestamp") timestamp: string,
    @Headers("x-webhook-signature") signature: string,
  ) {
    const raw = req.rawBody?.toString("utf8");
    if (!raw) throw new BadRequestException("Empty body");
    if (!this.gateway.verifyWebhook(raw, timestamp, signature)) throw new UnauthorizedException("Bad signature");
    const body = JSON.parse(raw) as CashfreeWebhook;
    const orderId = body.data?.order?.order_id ?? "";
    try {
      if (body.data?.refund?.refund_id) {
        await this.refunds.sync(body.data.refund.refund_id);
      } else if (orderId.startsWith("topup_")) {
        await this.wallet.checkTopUp(null, orderId.slice("topup_".length));
      } else if (orderId.startsWith("ord_")) {
        const bookingId = await this.bookings.orderIdForPaymentRef(orderId);
        if (bookingId) await this.bookings.checkCheckout(null, bookingId);
      }
    } catch (e) {
      // Answer 200 anyway: Cashfree retries on errors, and the app's own check covers this payment.
      this.log.warn(`webhook ${body.type} ${orderId}: ${(e as Error).message}`);
    }
    return { ok: true };
  }
}

@Module({ imports: [WalletModule, BookingModule], controllers: [PaymentWebhookController] })
export class PaymentWebhookModule {}
