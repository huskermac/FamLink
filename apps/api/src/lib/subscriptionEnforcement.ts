import { db } from "@famlink/db";

export interface SeatExpansionCheck {
  allowed: boolean;
  requiresConfirmation: boolean;
}

export async function checkSeatExpansion(
  familyGroupId: string,
  currentActiveCount: number
): Promise<SeatExpansionCheck> {
  const sub = await db.familySubscription.findUnique({
    where: { familyGroupId },
    include: { pricingTier: true }
  });

  if (!sub) return { allowed: true, requiresConfirmation: false };
  if (sub.pricingTier.activeUserLimit === null) return { allowed: true, requiresConfirmation: false };
  if (currentActiveCount < sub.seatCount) return { allowed: true, requiresConfirmation: false };

  return { allowed: true, requiresConfirmation: true };
}
