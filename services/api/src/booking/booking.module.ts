import { Module } from "@nestjs/common";
import { AdminController } from "../admin/admin.controller";
import { WalletModule } from "../wallet/wallet.module";
import { BookingController } from "./booking.controller";
import { BookingService } from "./booking.service";
import { CancellationPolicyService } from "./cancellation-policy.service";
import { PartnerBookingService } from "./partner-booking.service";

@Module({
  imports: [WalletModule],
  controllers: [BookingController, AdminController],
  providers: [BookingService, CancellationPolicyService, PartnerBookingService],
  exports: [PartnerBookingService],
})
export class BookingModule {}
