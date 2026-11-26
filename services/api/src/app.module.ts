import { Module } from "@nestjs/common";
import { CatalogModule } from "./catalog/catalog.module";
import { HealthController } from "./health/health.controller";

// Modules from the plan (Identity, Booking, Bus, Charging, Wallet, Payments,
// Messaging, Admin) are added here as they are built. Catalog is the first:
// read-only search over bus trips and chargers using seed data.
@Module({
  imports: [CatalogModule],
  controllers: [HealthController],
})
export class AppModule {}
