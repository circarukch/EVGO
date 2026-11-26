import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { BookingModule } from "./booking/booking.module";
import { CatalogModule } from "./catalog/catalog.module";
import { ChargingModule } from "./charging/charging.module";
import { HealthController } from "./health/health.controller";
import { PrismaModule } from "./prisma/prisma.service";
import { WalletModule } from "./wallet/wallet.module";

// Modules from the plan still to come: Charging sessions, Payments gateway, Messaging, Admin.
@Module({
  imports: [PrismaModule, AuthModule, CatalogModule, WalletModule, BookingModule, ChargingModule],
  controllers: [HealthController],
})
export class AppModule {}
