/**
 * AI entitlement resolver (P3-02 / W2; seat cap removed 2026-08-15, decision 10).
 *
 * Coverage is derived live on every call — never materialized. A person is
 * "covered" iff they are an active (non-suspended) member of at least one family
 * whose subscription is entitling (ACTIVE | TRIALING) AND on a paid tier
 * (PricingTier.stripePriceId !== null). There is no per-seat cap: seatCount is the
 * family's active-member headcount (reconciled by the daily cron), not a coverage limit.
 */

import { db } from "@famlink/db";

export const AI_DAILY_LIMIT_COVERED = 20;
export const AI_DAILY_LIMIT_FREE = 3;
export const AI_DAILY_LIMIT_FOREIGN = 3; // cap for foreign (unpaid) family contexts

const ENTITLING_STATUSES = new Set(["ACTIVE", "TRIALING"]);

export async function isPersonCoveredByFamily(
  personId: string,
  familyGroupId: string
): Promise<boolean> {
  const sub = await db.familySubscription.findUnique({
    where: { familyGroupId },
    select: { status: true, pricingTier: { select: { stripePriceId: true } } }
  });
  if (!sub) return false;
  if (!ENTITLING_STATUSES.has(sub.status)) return false;
  if (sub.pricingTier.stripePriceId === null) return false; // free tier never covers

  const membership = await db.familyMember.findFirst({
    where: { familyGroupId, personId, suspendedAt: null },
    select: { id: true }
  });
  return membership !== null;
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

export interface AiEntitlement {
  covered: boolean;
  dailyLimit: number;
  foreignContext: boolean;
}

export async function getAiEntitlementForUser(
  userId: string,
  familyGroupId?: string
): Promise<AiEntitlement> {
  const person = await db.person.findUnique({ where: { userId }, select: { id: true } });
  if (!person) {
    return { covered: false, dailyLimit: AI_DAILY_LIMIT_FREE, foreignContext: !!familyGroupId };
  }
  const covered = await isPersonCovered(person.id);
  const dailyLimit = covered ? AI_DAILY_LIMIT_COVERED : AI_DAILY_LIMIT_FREE;
  const foreignContext = familyGroupId ? !(await isPersonCoveredByFamily(person.id, familyGroupId)) : false;
  return { covered, dailyLimit, foreignContext };
}

export async function getAiDailyLimitForUser(userId: string): Promise<number> {
  return (await getAiEntitlementForUser(userId)).dailyLimit;
}
