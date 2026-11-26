import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { DEFAULT_TIERS, RefundTier, validateTiers } from "./cancellation";

@Injectable()
export class CancellationPolicyService {
  constructor(private readonly db: PrismaService) {}

  async get(orgId: string, tx: Prisma.TransactionClient = this.db): Promise<{ tiers: RefundTier[]; isDefault: boolean }> {
    const row = await tx.cancellationPolicy.findUnique({ where: { orgId } });
    return row ? { tiers: row.tiers as unknown as RefundTier[], isDefault: false } : { tiers: DEFAULT_TIERS, isDefault: true };
  }

  async set(orgId: string, input: unknown) {
    const tiers = validateTiers(input);
    const org = await this.db.organisation.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException("Operator not found");
    const data = { tiers: tiers as unknown as Prisma.InputJsonValue };
    await this.db.cancellationPolicy.upsert({ where: { orgId }, update: data, create: { orgId, ...data } });
    return { orgId, tiers, isDefault: false };
  }

  async reset(orgId: string) {
    await this.db.cancellationPolicy.deleteMany({ where: { orgId } });
    return { orgId, tiers: DEFAULT_TIERS, isDefault: true };
  }
}
