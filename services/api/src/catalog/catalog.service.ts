import { Injectable, NotFoundException } from "@nestjs/common";
import { Charger, chargers, places, Trip, trips } from "./seed";

@Injectable()
export class CatalogService {
  searchTrips(fromCity: string, toCity: string) {
    const cityOf = (placeId: string) => places.find((p) => p.id === placeId)?.city.toLowerCase();
    return trips
      .filter((t: Trip) => cityOf(t.from) === fromCity.toLowerCase() && cityOf(t.to) === toCity.toLowerCase())
      .map((t) => ({ ...t, chargersAtBoarding: this.chargersAt(t.from).filter((c) => c.access === "public").length }));
  }

  /** Public chargers, optionally filtered by vehicle segment and city. Fleet-only depot chargers are hidden. */
  searchChargers(opts: { segment?: string; city?: string }) {
    return chargers
      .filter((c) => c.access === "public")
      .filter((c) => !opts.segment || c.segments.includes(opts.segment.toUpperCase() as Charger["segments"][number]))
      .filter((c) => !opts.city || places.find((p) => p.id === c.placeId)?.city.toLowerCase() === opts.city.toLowerCase())
      .map((c) => ({ ...c, place: places.find((p) => p.id === c.placeId) }));
  }

  getCharger(id: string) {
    const c = chargers.find((x) => x.id === id);
    if (!c) throw new NotFoundException(`Charger ${id} not found`);
    return { ...c, place: places.find((p) => p.id === c.placeId) };
  }

  private chargersAt(placeId: string) {
    return chargers.filter((c) => c.placeId === placeId);
  }
}
