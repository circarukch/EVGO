import { Global, Module } from "@nestjs/common";
import { InventoryRegistry } from "./inventory.registry";

@Global()
@Module({ providers: [InventoryRegistry], exports: [InventoryRegistry] })
export class InventoryModule {}
