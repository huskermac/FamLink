import { fetchTiers } from "@/lib/api/billing";
import Link from "next/link";

export default async function PlansPage() {
  const tiers = await fetchTiers();

  return (
    <div style={{ padding: 32, maxWidth: 800 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>Choose a Plan</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 32 }}>All plans include unlimited passive (guest) members.</p>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {tiers.map(tier => (
          <div key={tier.tierKey} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 24, minWidth: 220, flex: "1 1 220px" }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>{tier.displayName}</h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
              {tier.activeUserLimit === null ? "Unlimited active members" : `Up to ${tier.activeUserLimit} active members`}
            </p>
            {tier.trialDays && (
              <p style={{ color: "var(--accent)", fontSize: 13, marginBottom: 16 }}>{tier.trialDays}-day free trial</p>
            )}
            {tier.stripePriceId === null ? (
              <Link href="/billing/activate-free" style={{ display: "inline-block", padding: "8px 20px", borderRadius: 8, background: "var(--accent)", color: "#fff", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>
                Activate Free
              </Link>
            ) : (
              <Link href={`/billing/checkout?tier=${tier.tierKey}`} style={{ display: "inline-block", padding: "8px 20px", borderRadius: 8, background: "var(--accent)", color: "#fff", textDecoration: "none", fontSize: 14, fontWeight: 500 }}>
                Subscribe
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
