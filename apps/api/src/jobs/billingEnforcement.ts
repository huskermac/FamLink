import cron from "node-cron";
import { db } from "@famlink/db";

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

export async function runDowngradeEnforcementPass(): Promise<void> {
  const subs = await db.familySubscription.findMany({
    where: {
      downgradeGraceEndsAt: { not: null, lt: new Date() },
      pendingDowngradeSeatCount: { not: null }
    }
  });

  for (const sub of subs) {
    const newSeatCount = sub.pendingDowngradeSeatCount!;

    const activeMembers = await db.familyMember.findMany({
      where: {
        familyGroupId: sub.familyGroupId,
        suspendedAt: null,
        person: { userId: { not: null } }
      },
      orderBy: { joinedAt: "asc" },
      include: { person: true }
    });

    const overCount = activeMembers.length - newSeatCount;
    if (overCount <= 0) {
      await db.familySubscription.update({
        where: { id: sub.id },
        data: {
          seatCount: newSeatCount,
          pendingDowngradeTierKey: null,   // tierKey was already updated by the webhook handler
          pendingDowngradeSeatCount: null,
          downgradeGraceEndsAt: null
        }
      });
      continue;
    }

    // Suspend the newest-joined over-limit members (last in the asc-sorted list)
    const toSuspend = activeMembers.slice(-overCount);
    await db.$transaction(async (tx) => {
      for (const member of toSuspend) {
        await tx.familyMember.update({
          where: { id: member.id },
          data: { suspendedAt: new Date() }
        });
      }
      await tx.familySubscription.update({
        where: { id: sub.id },
        data: {
          seatCount: newSeatCount,
          pendingDowngradeTierKey: null,   // tierKey was already updated by the webhook handler
          pendingDowngradeSeatCount: null,
          downgradeGraceEndsAt: null
        }
      });
    });
  }
}

export function startBillingCron(): void {
  // Run at 06:00 UTC daily
  cron.schedule("0 6 * * *", async () => {
    try {
      await runTrialWarningPass();
      await runDowngradeEnforcementPass();
    } catch (err) {
      console.error("Billing enforcement cron error", err);
    }
  });
}
