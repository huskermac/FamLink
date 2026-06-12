"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useState } from "react";
import { activateFree } from "@/lib/api/billing";
import { getMyFamilies } from "@/lib/api/family";

export default function ActivateFreePage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleActivate() {
    setLoading(true);
    setError(null);
    try {
      const families = await getMyFamilies(getToken);
      await activateFree(getToken, families[0]?.familyGroup.id);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: 480 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--text-primary)", marginBottom: 16 }}>
        Activate Free Plan
      </h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 8 }}>
        The free plan lets you build your family tree and invite family members.
        You can upgrade anytime as your family grows.
      </p>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 24 }}>
        No credit card required.
      </p>
      {error && (
        <p style={{ color: "var(--danger, #ef4444)", marginBottom: 16 }}>{error}</p>
      )}
      <button
        onClick={handleActivate}
        disabled={loading}
        style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", cursor: "pointer", fontWeight: 500 }}
      >
        {loading ? "Activating…" : "Activate Free Plan"}
      </button>
    </div>
  );
}
