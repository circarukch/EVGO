import { Global, Module } from "@nestjs/common";
import { config } from "../config";
import { CashfreePaymentGateway } from "./cashfree.gateway";
import { PAYMENT_GATEWAY } from "./gateway";
import { MockPaymentGateway, NotConfiguredPaymentGateway } from "./mock.gateway";
import { RefundsService } from "./refunds.service";

@Global()
@Module({
  providers: [
    {
      provide: PAYMENT_GATEWAY,
      useFactory: () => {
        const g = config.paymentGateway;
        if (g.kind === "mock") return new MockPaymentGateway();
        if (g.kind === "cashfree") return new CashfreePaymentGateway(g);
        return new NotConfiguredPaymentGateway();
      },
    },
    RefundsService,
  ],
  exports: [PAYMENT_GATEWAY, RefundsService],
})
export class PaymentsModule {}
