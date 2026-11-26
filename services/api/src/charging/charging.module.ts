import { Module } from "@nestjs/common";
import { config } from "../config";
import { WalletModule } from "../wallet/wallet.module";
import { CHARGER_CONTROL, NotConnectedChargerControl, SimulatedChargerControl } from "./charger-control";
import { ChargingController } from "./charging.controller";
import { ChargingService } from "./charging.service";

@Module({
  imports: [WalletModule],
  controllers: [ChargingController],
  providers: [
    ChargingService,
    {
      provide: CHARGER_CONTROL,
      useFactory: () =>
        config.chargerControl === "simulated" ? new SimulatedChargerControl(config.chargingSimSpeedup) : new NotConnectedChargerControl(),
    },
  ],
})
export class ChargingModule {}
