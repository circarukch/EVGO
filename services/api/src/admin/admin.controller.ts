import { Body, Controller, Delete, Get, Param, Put, UseGuards } from "@nestjs/common";
import { CancellationPolicyService } from "../booking/cancellation-policy.service";
import { PrismaService } from "../prisma/prisma.service";
import { AdminGuard } from "./admin.guard";

@Controller("admin")
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly policies: CancellationPolicyService, private readonly db: PrismaService) {}

  @Get("operators")
  async operators() {
    const orgs = await this.db.organisation.findMany({ where: { kinds: { has: "BUS_OPERATOR" } }, orderBy: { name: "asc" } });
    return Promise.all(orgs.map(async (o) => ({ id: o.id, name: o.name, cancellationPolicy: await this.policies.get(o.id) })));
  }

  @Get("operators/:orgId/cancellation-policy")
  get(@Param("orgId") orgId: string) {
    return this.policies.get(orgId);
  }

  @Put("operators/:orgId/cancellation-policy")
  set(@Param("orgId") orgId: string, @Body() body: { tiers: unknown }) {
    return this.policies.set(orgId, body?.tiers);
  }

  @Delete("operators/:orgId/cancellation-policy")
  reset(@Param("orgId") orgId: string) {
    return this.policies.reset(orgId);
  }
}
