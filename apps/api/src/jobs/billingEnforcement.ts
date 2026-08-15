import cron from "node-cron";
import { db } from "@famlink/db";
import { reconcileSeats } from "../lib/subscriptionEnforcement";

export async function runTrialWarningPass(): Promise<void> {
  const subs = await db.familySubscription.findMany({
    where: {
      trialEndsAt: { not: null },
      trialWarningSentAt: null,
      status: "TRIALING"
    },
    include: { pricingTier: true }
  });

  for (const sub of subs) {
    const warningDays = sub.pricingTier.trialWarningDays ?? 3;
    const warningThreshold = new Date(Date.now() + warningDays * 86400000);
    if (!sub.trialEndsAt || sub.trialEndsAt > warningThreshold) continue;

    await db.familySubscription.update({
      where: { id: sub.id },
      data: { trialWarningSentAt: new Date() }
    });
    // Future: send email/in-app notification here
  }
}

export async function runSeatReconciliationPass(): Promise<void> {
  const subs = await db.familySubscription.findMany({
    where: {
      status: { in: ["ACTIVE", "TRIALING"] },
      pricingTier: { stripePriceId: { not: null } }
    },
    select: { familyGroupId: true }
  });

  for (const { familyGroupId } of subs) {
    try {
      await reconcileSeats(familyGroupId);
    } catch (err) {
      // Non-fatal per family: one Stripe error must not abort the pass.
      console.error("Seat reconciliation error for family", familyGroupId, err);
    }
  }
}

export function startBillingCron(): void {
  // Run at 06:00 UTC daily
  cron.schedule("0 6 * * *", async () => {
    try {
      await runTrialWarningPass();
      await runSeatReconciliationPass();
    } catch (err) {
      console.error("Billing enforcement cron error", err);
    }
  });
}
