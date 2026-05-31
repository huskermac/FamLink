import Link from "next/link";

export default function BillingSuccessPage() {
  return (
    <div style={{ padding: 64, textAlign: "center" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>You're all set!</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: 32 }}>Your subscription is now active.</p>
      <Link href="/settings/billing" style={{ padding: "10px 24px", borderRadius: 8, background: "var(--accent)", color: "#fff", textDecoration: "none", fontWeight: 500 }}>
        View Billing Settings
      </Link>
    </div>
  );
}
