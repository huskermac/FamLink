"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { fetchSubscription, createPortalSession } from "@/lib/api/billing";
import type { FamilySubscription } from "@/lib/api/billing";

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  TRIALING: "Trial",
  PAST_DUE: "Past Due",
  CANCELED: "Canceled",
  SUSPENDED: "Suspended"
};

export default function BillingSettingsPage() {
  const { getToken } = useAuth();
  const [sub, setSub] = useState<FamilySubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    fetchSubscription(getToken).then(setSub).finally(() => setLoading(false));
  }, [getToken]);

  async function handleManage() {
    setRedirecting(true);
    try {
      const url = await createPortalSession(getToken);
      window.open(url, "_blank");
    } finally {
      setRedirecting(false);
    }
  }

  if (loading) return <div style={{ padding: 32, color: "var(--text-muted)" }}>Loading…</div>;

  if (!sub) {
    return (
      <div style={{ padding: 32 }}>
        <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>No active subscription.</p>
        <Link href="/billing/plans" style={{ color: "var(--accent)" }}>View Plans</Link>
      </div>
    );
  }

  return (
    <div style={{ padding: 32, maxWidth: 480 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text-primary)", marginBottom: 24 }}>Billing</h1>

      <div style={{ marginBottom: 8, color: "var(--text-secondary)" }}>
        Plan: <strong style={{ color: "var(--text-primary)" }}>{sub.tierKey}</strong>
      </div>
      <div style={{ marginBottom: 8, color: "var(--text-secondary)" }}>
        Seats: <strong style={{ color: "var(--text-primary)" }}>{sub.seatCount}</strong>
      </div>
      <div style={{ marginBottom: 24, color: "var(--text-secondary)" }}>
        Status: <span style={{ color: sub.status === "ACTIVE" || sub.status === "TRIALING" ? "var(--success, #22c55e)" : "var(--danger, #ef4444)", fontWeight: 500 }}>
          {STATUS_LABELS[sub.status] ?? sub.status}
        </span>
      </div>

      {sub.trialEndsAt && sub.status === "TRIALING" && (
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
          Trial ends {new Date(sub.trialEndsAt).toLocaleDateString()}
        </p>
      )}

      <button
        onClick={handleManage}
        disabled={redirecting}
        style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer", fontWeight: 500 }}
      >
        {redirecting ? "Opening…" : "Manage Subscription"}
      </button>
    </div>
  );
}
