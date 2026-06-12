"use client";

import { useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchTiers, fetchSubscription, createCheckoutSession } from "@/lib/api/billing";
import type { PricingTier } from "@/lib/api/billing";
import { getMyFamilies } from "@/lib/api/family";

export default function CheckoutPage() {
  const { getToken } = useAuth();
  const searchParams = useSearchParams();
  const tierKey = searchParams?.get("tier") ?? null;

  const [tiers, setTiers] = useState<PricingTier[]>([]);
  const [familyId, setFamilyId] = useState<string | undefined>(undefined);
  const [seats, setSeats] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tierKey) {
      setLoading(false);
      return;
    }
    // Billing is family-scoped; use the same first family the app shell shows.
    (async () => {
      try {
        const families = await getMyFamilies(getToken);
        const id = families[0]?.familyGroup.id;
        setFamilyId(id);
        const [tierList, sub] = await Promise.all([fetchTiers(), fetchSubscription(getToken, id)]);
        setTiers(tierList);
        if (sub?.seatCount) setSeats(sub.seatCount);
      } catch {
        // page still renders; checkout button will surface any API error
      } finally {
        setLoading(false);
      }
    })();
  }, [getToken, tierKey]);

  async function handleCheckout() {
    if (!tierKey) return;
    setSubmitting(true);
    setError(null);
    try {
      const successUrl = `${window.location.origin}/billing/success`;
      const cancelUrl = `${window.location.origin}/billing/plans`;
      const checkoutUrl = await createCheckoutSession(getToken, tierKey, seats, successUrl, cancelUrl, familyId);
      window.location.href = checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)" }}>Loading…</div>;

  if (!tierKey) {
    return (
      <div style={{ padding: 32 }}>
        <p style={{ color: "var(--text-secondary)" }}>
          No plan selected. <Link href="/billing/plans" style={{ color: "var(--accent)" }}>View Plans</Link>
        </p>
      </div>
    );
  }

  const tier = tiers.find((t) => t.tierKey === tierKey);
  const tierDisplayName = tier?.displayName ?? null;

  return (
    <div style={{ padding: 32, maxWidth: 480 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text-primary)", marginBottom: 24 }}>
        Subscribe to {tierDisplayName || tierKey}
      </h1>

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginBottom: 12 }}>
          How many seats do you need?
        </h2>
        <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 16, lineHeight: 1.5 }}>
          A seat is for an active FamLink user — someone who signs in and participates.
          Family members you add to the tree without an account (children, elderly
          relatives, deceased) are always free and never count toward your seat count.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="number"
            min={1}
            value={seats}
            onChange={(e) => setSeats(Math.max(1, parseInt(e.target.value, 10) || 1))}
            style={{
              width: 80,
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text-primary)",
              fontSize: 16,
              textAlign: "center"
            }}
          />
          <label style={{ color: "var(--text-secondary)", fontSize: 14 }}>seats</label>
        </div>
      </div>

      {error && (
        <p style={{ color: "var(--danger, #ef4444)", marginBottom: 16, fontSize: 14 }}>{error}</p>
      )}

      <button
        onClick={handleCheckout}
        disabled={submitting}
        style={{
          padding: "10px 24px",
          borderRadius: 8,
          border: "none",
          background: "var(--accent)",
          color: "#fff",
          cursor: submitting ? "default" : "pointer",
          fontWeight: 500,
          opacity: submitting ? 0.7 : 1
        }}
      >
        {submitting ? "Redirecting…" : "Continue to Payment"}
      </button>
    </div>
  );
}
