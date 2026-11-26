import { BadRequestException } from "@nestjs/common";

export interface RefundTier {
  minHoursBefore: number;
  refundPercent: number;
}

/** Used for operators that have not set their own policy in the console. */
export const DEFAULT_TIERS: RefundTier[] = [
  { minHoursBefore: 24, refundPercent: 90 },
  { minHoursBefore: 6, refundPercent: 50 },
];

/** The share of the fare refunded, or null when cancellation is closed. */
export function refundShare(hoursBeforeDeparture: number, tiers: RefundTier[] = DEFAULT_TIERS): number | null {
  const sorted = [...tiers].sort((a, b) => b.minHoursBefore - a.minHoursBefore);
  const tier = sorted.find((t) => hoursBeforeDeparture >= t.minHoursBefore);
  return tier ? tier.refundPercent / 100 : null;
}

/** Hours before departure after which cancellation is closed. */
export const cutoffHours = (tiers: RefundTier[]) => Math.min(...tiers.map((t) => t.minHoursBefore));

/** Check and normalise tiers sent from the console. Throws 400 with a readable reason. */
export function validateTiers(input: unknown): RefundTier[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 6) {
    throw new BadRequestException("Set between 1 and 6 refund tiers");
  }
  const tiers = input.map((t, i) => {
    const h = Number((t as RefundTier)?.minHoursBefore);
    const p = Number((t as RefundTier)?.refundPercent);
    if (!Number.isFinite(h) || h < 0 || h > 720) throw new BadRequestException(`Tier ${i + 1}: hours must be between 0 and 720`);
    if (!Number.isInteger(p) || p < 0 || p > 100) throw new BadRequestException(`Tier ${i + 1}: refund must be a whole percent from 0 to 100`);
    return { minHoursBefore: h, refundPercent: p };
  });
  tiers.sort((a, b) => b.minHoursBefore - a.minHoursBefore);
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].minHoursBefore === tiers[i - 1].minHoursBefore) throw new BadRequestException("Two tiers have the same hours");
    if (tiers[i].refundPercent > tiers[i - 1].refundPercent) {
      throw new BadRequestException("Refunds must not grow closer to departure");
    }
  }
  return tiers;
}
