import { db } from "@famlink/db";
import { stripe } from "./stripeClient";

const ENTITLING_STATUSES = new Set(["ACTIVE", "TRIALING"]);

/**
 * Reconcile a family's Stripe seat quantity to its true active-member headcount.
 * Idempotent: sets an absolute quantity and only calls Stripe when it differs.
 * No-op for missing / non-entitling / free-tier subscriptions. Billed seat
 * quantity = max(0, activeHeadcount - includedSeats); proration is enabled so a
 * mid-cycle change is billed as arrears on the next invoice.
 */
export async function reconcileSeats(familyGroupId: string): Promise<void> {
  const sub = await db.familySubscription.findUnique({
    where: { familyGroupId },
    include: { pricingTier: true }
  });
  if (!sub) return;
  if (!ENTITLING_STATUSES.has(sub.status)) return;
  if (sub.pricingTier.stripePriceId === null) return; // free tier never bills

  const activeCount = await db.familyMember.count({
    where: { familyGroupId, suspendedAt: null, person: { userId: { not: null } } }
  });

  // Local billing quantity always tracks reality.
  if (sub.seatCount !== activeCount) {
    await db.familySubscription.update({
      where: { familyGroupId },
      data: { seatCount: activeCount }
    });
  }

  // Nothing to push to Stripe (no live subscription or no per-seat price).
  if (!sub.stripeSubscriptionId || !sub.pricingTier.stripeSeatPriceId) return;

  const desiredQty = Math.max(0, activeCount - sub.pricingTier.includedSeats);
  const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
  const seatItem = stripeSub.items.data.find(
    (item) => item.price?.id === sub.pricingTier.stripeSeatPriceId
  );
  const currentQty = seatItem?.quantity ?? 0;

  // Zero overflow seats: remove any existing seat item. Handled BEFORE the
  // equality guard so a stray quantity-0 item is still cleaned up (Stripe
  // permits quantity-0 subscription items, so currentQty could equal desiredQty
  // at 0 with an item still present).
  if (desiredQty === 0) {
    if (!seatItem) return; // nothing to bill, nothing to remove
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      items: [{ id: seatItem.id, deleted: true }],
      proration_behavior: "create_prorations"
    });
    return;
  }

  if (currentQty === desiredQty) return; // idempotent no-op (already correct)

  await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    items: [
      seatItem
        ? { id: seatItem.id, quantity: desiredQty }
        : { price: sub.pricingTier.stripeSeatPriceId, quantity: desiredQty }
    ],
    proration_behavior: "create_prorations"
  });
}

/**
 * Whether adding one more active (userId != null) member would raise billable
 * headcount beyond the tier's included seats on a paid, entitling subscription.
 * Pure read; no Stripe call. Consumed by the consent-accept path (W1 PR-2) and
 * CIF activation to surface a "your bill will change" indicator.
 */
export async function billingImpactForAdd(
  familyGroupId: string
): Promise<{ willBill: boolean; note: string | null }> {
  const sub = await db.familySubscription.findUnique({
    where: { familyGroupId },
    include: { pricingTier: true }
  });
  // Only promise a bill under the exact conditions reconcileSeats would actually
  // charge: entitling + paid + a live Stripe subscription + a per-seat price.
  if (
    !sub ||
    !ENTITLING_STATUSES.has(sub.status) ||
    sub.pricingTier.stripePriceId === null ||
    sub.pricingTier.stripeSeatPriceId === null ||
    !sub.stripeSubscriptionId
  ) {
    return { willBill: false, note: null };
  }
  const activeCount = await db.familyMember.count({
    where: { familyGroupId, suspendedAt: null, person: { userId: { not: null } } }
  });
  const willBill = activeCount + 1 > sub.pricingTier.includedSeats;
  return {
    willBill,
    note: willBill ? "This will be reflected on your next invoice." : null
  };
}
