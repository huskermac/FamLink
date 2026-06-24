/**
 * AI entitlement resolver (P3-02 / W2).
 *
 * Coverage is derived live on every call — never materialized. A person is
 * "covered" iff they are an active (non-suspended) member of at least one family
 * whose subscription is entitling (ACTIVE | TRIALING) AND on a paid tier
 * (PricingTier.stripePriceId !== null), AND they fall within that family's
 * seatCount when active members are ordered by joinedAt ascending.
 */

import { db } from "@famlink/db";

export const AI_DAILY_LIMIT_COVERED = 20;
export const AI_DAILY_LIMIT_FREE = 3;

const ENTITLING_STATUSES = new Set(["ACTIVE", "TRIALING"]);

export async function isPersonCoveredByFamily(
  personId: string,
  familyGroupId: string
): Promise<boolean> {
  const sub = await db.familySubscription.findUnique({
    where: { familyGroupId },
    select: { status: true, seatCount: true, pricingTier: { select: { stripePriceId: true } } }
  });
  if (!sub) return false;
  if (!ENTITLING_STATUSES.has(sub.status)) return false;
  if (sub.pricingTier.stripePriceId === null) return false; // free tier never covers

  const seated = await db.familyMember.findMany({
    where: { familyGroupId, suspendedAt: null },
    // `id` is a stable tiebreak so the seat boundary is deterministic when
    // two members share a joinedAt timestamp.
    orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
    take: sub.seatCount,
    select: { personId: true }
  });
  return seated.some((m) => m.personId === personId);
}

// NOTE: O(memberships) — ~2 queries per family. Fine for the small number of
// families a person belongs to; collapse to one join if that ever grows.
export async function isPersonCovered(personId: string): Promise<boolean> {
  const memberships = await db.familyMember.findMany({
    where: { personId, suspendedAt: null },
    select: { familyGroupId: true }
  });
  for (const { familyGroupId } of memberships) {
    if (await isPersonCoveredByFamily(personId, familyGroupId)) return true;
  }
  return false;
}

export async function getAiDailyLimit(personId: string): Promise<number> {
  return (await isPersonCovered(personId)) ? AI_DAILY_LIMIT_COVERED : AI_DAILY_LIMIT_FREE;
}

export async function getAiDailyLimitForUser(userId: string): Promise<number> {
  const person = await db.person.findUnique({ where: { userId }, select: { id: true } });
  if (!person) return AI_DAILY_LIMIT_FREE;
  return getAiDailyLimit(person.id);
}
