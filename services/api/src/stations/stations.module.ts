import { Module } from "@nestjs/common";
import { GatewayClient } from "./gateway-client";
import { GatewayKeyGuard, OcppInternalController, StationsAdminController } from "./stations.controller";
import { StationsService } from "./stations.service";

@Module({
  controllers: [StationsAdminController, OcppInternalController],
  providers: [StationsService, GatewayClient, GatewayKeyGuard],
  exports: [StationsService],
})
export class StationsModule {}
