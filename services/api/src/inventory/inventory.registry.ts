import { Injectable } from "@nestjs/common";
import { config } from "../config";
import { MockPartnerProvider } from "./mock-partner.provider";
import { BusInventoryProvider } from "./provider";

/** Every adapter the code knows about. A real vendor adapter is added here. */
const FACTORIES: Record<string, () => BusInventoryProvider> = {
  "mock-partner": () => new MockPartnerProvider(),
};

/** The partner bus inventory sources switched on for this deployment (BUS_INVENTORY_PROVIDERS). */
@Injectable()
export class InventoryRegistry {
  private readonly providers = new Map<string, BusInventoryProvider>();

  constructor() {
    for (const id of config.busInventoryProviders) {
      const make = FACTORIES[id];
      if (!make) throw new Error(`Unknown bus inventory provider "${id}" in BUS_INVENTORY_PROVIDERS`);
      this.providers.set(id, make());
    }
  }

  all(): BusInventoryProvider[] {
    return [...this.providers.values()];
  }

  get(id: string): BusInventoryProvider | undefined {
    return this.providers.get(id);
  }
}
