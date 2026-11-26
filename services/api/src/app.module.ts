import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { BookingModule } from "./booking/booking.module";
import { CatalogModule } from "./catalog/catalog.module";
import { ChargingModule } from "./charging/charging.module";
import { HealthController } from "./health/health.controller";
import { PaymentsModule } from "./payments/payments.module";
import { PaymentWebhookModule } from "./payments/webhook.controller";
import { PrismaModule } from "./prisma/prisma.service";
import { StationsModule } from "./stations/stations.module";
import { WalletModule } from "./wallet/wallet.module";

// Modules from the plan still to come: Messaging, payouts to operators.
@Module({
  imports: [PrismaModule, PaymentsModule, AuthModule, CatalogModule, WalletModule, BookingModule, ChargingModule, StationsModule, PaymentWebhookModule],
  controllers: [HealthController],
})
export class AppModule {}
