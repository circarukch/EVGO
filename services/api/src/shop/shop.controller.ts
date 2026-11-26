import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { AdminGuard } from "../admin/admin.guard";
import { AuthGuard, AuthUser, CurrentUser } from "../auth/auth.guard";
import { LeadInput, ProductFilter, ProductInput, ShopService, SITE_TYPES } from "./shop.service";

/** Public catalogue: anyone can browse. Asking for a quote needs a login, so the team can call back. */
@Controller("shop")
export class ShopController {
  constructor(private readonly shop: ShopService) {}

  @Get("chargers")
  list(@Query() q: ProductFilter) {
    return this.shop.list(q);
  }

  @Get("chargers/:id")
  get(@Param("id") id: string) {
    return this.shop.get(id);
  }

  @Get("site-types")
  siteTypes() {
    return SITE_TYPES;
  }

  @Post("leads")
  @UseGuards(AuthGuard)
  lead(@CurrentUser() user: AuthUser, @Body() body: LeadInput) {
    return this.shop.createLead(user.id, body);
  }

  @Get("leads/mine")
  @UseGuards(AuthGuard)
  mine(@CurrentUser() user: AuthUser) {
    return this.shop.myLeads(user.id);
  }
}

@Controller("admin/shop")
@UseGuards(AdminGuard)
export class ShopAdminController {
  constructor(private readonly shop: ShopService) {}

  @Get("products")
  products(@Query() q: ProductFilter) {
    return this.shop.list(q, true);
  }

  @Get("products/:id")
  product(@Param("id") id: string) {
    return this.shop.get(id, true);
  }

  @Post("products")
  create(@Body() body: ProductInput) {
    return this.shop.createProduct(body);
  }

  @Put("products/:id")
  update(@Param("id") id: string, @Body() body: ProductInput) {
    return this.shop.updateProduct(id, body);
  }

  @Get("leads")
  leads(@Query("status") status?: string) {
    return this.shop.leads(status);
  }

  @Patch("leads/:id")
  setStatus(@Param("id") id: string, @Body() body: { status?: string }) {
    return this.shop.setLeadStatus(id, String(body?.status ?? ""));
  }
}
