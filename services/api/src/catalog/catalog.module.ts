import { Module } from "@nestjs/common";
import { BookingModule } from "../booking/booking.module";
import { CatalogController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";

@Module({ imports: [BookingModule], controllers: [CatalogController], providers: [CatalogService] })
export class CatalogModule {}
