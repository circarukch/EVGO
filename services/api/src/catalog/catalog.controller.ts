import { BadRequestException, Controller, Get, Param, Query } from "@nestjs/common";
import { CatalogService } from "./catalog.service";

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("trips")
  trips(@Query("from") from?: string, @Query("to") to?: string) {
    if (!from || !to) throw new BadRequestException("from and to are required");
    return this.catalog.searchTrips(from, to);
  }

  @Get("chargers")
  chargers(@Query("segment") segment?: string, @Query("city") city?: string) {
    return this.catalog.searchChargers({ segment, city });
  }

  @Get("chargers/:id")
  charger(@Param("id") id: string) {
    return this.catalog.getCharger(id);
  }
}
