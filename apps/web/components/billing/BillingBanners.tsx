import type { FamilySubscription } from "@/lib/api/billing";

interface BillingBannersProps {
  subscription: FamilySubscription;
  trialWarningSentAt?: string | null;
}

export function BillingBanners({ subscription, trialWarningSentAt }: BillingBannersProps) {
  const banners: { key: string; message: string; color: string }[] = [];

  if (subscription.status === "TRIALING" && trialWarningSentAt && subscription.trialEndsAt) {
    const date = new Date(subscription.trialEndsAt).toLocaleDateString();
    banners.push({ key: "trial", message: `Your trial ends on ${date}. Subscribe to keep access.`, color: "var(--warning, #f59e0b)" });
  }

  if (subscription.status === "PAST_DUE") {
    banners.push({ key: "past-due", message: "Payment failed. Update your payment method to restore full access.", color: "var(--danger, #ef4444)" });
  }

  if (subscription.pendingDowngradeTierKey && subscription.downgradeGraceEndsAt) {
    const date = new Date(subscription.downgradeGraceEndsAt).toLocaleDateString();
    banners.push({ key: "downgrade", message: `Plan change pending — demote or remove ${subscription.seatCount - (subscription.pendingDowngradeSeatCount ?? 0)} members by ${date} to avoid suspension.`, color: "var(--warning, #f59e0b)" });
  }

  if (banners.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 16px" }}>
      {banners.map(b => (
        <div key={b.key} style={{ padding: "10px 16px", borderRadius: 8, background: b.color + "22", borderLeft: `3px solid ${b.color}`, color: "var(--text-primary)", fontSize: 13 }}>
          {b.message}
        </div>
      ))}
    </div>
  );
}
