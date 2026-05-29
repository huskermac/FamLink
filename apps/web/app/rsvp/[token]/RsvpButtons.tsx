"use client";
import { useState } from "react";
import { submitGuestRsvp } from "@/lib/api/events";

interface Props {
  token: string;
  initialStatus: string;
}

export function RsvpButtons({ token, initialStatus }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [loading, setLoading] = useState(false);

  async function respond(next: "ACCEPTED" | "DECLINED" | "TENTATIVE") {
    setLoading(true);
    try {
      const result = await submitGuestRsvp(token, next);
      setStatus(result.status);
    } finally {
      setLoading(false);
    }
  }

  if (status === "ACCEPTED") {
    return (
      <div style={{ textAlign: "center", padding: "24px" }}>
        <div style={{ fontSize: "32px", marginBottom: "8px" }}>✓</div>
        <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>You're going!</p>
        <div style={{ display: "flex", gap: "8px", justifyContent: "center", marginTop: "12px" }}>
          <button
            onClick={() => respond("TENTATIVE")}
            disabled={loading}
            style={{ fontSize: "13px", color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            Maybe
          </button>
          <button
            onClick={() => respond("DECLINED")}
            disabled={loading}
            style={{ fontSize: "13px", color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            Can't make it
          </button>
        </div>
      </div>
    );
  }

  if (status === "TENTATIVE") {
    return (
      <div style={{ textAlign: "center", padding: "24px" }}>
        <div style={{ fontSize: "32px", marginBottom: "8px" }}>?</div>
        <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>You might be going.</p>
        <div style={{ display: "flex", gap: "8px", justifyContent: "center", marginTop: "12px" }}>
          <button
            onClick={() => respond("ACCEPTED")}
            disabled={loading}
            style={{ fontSize: "13px", color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            I'll be there
          </button>
          <button
            onClick={() => respond("DECLINED")}
            disabled={loading}
            style={{ fontSize: "13px", color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            Can't make it
          </button>
        </div>
      </div>
    );
  }

  if (status === "DECLINED") {
    return (
      <div style={{ textAlign: "center", padding: "24px" }}>
        <p style={{ color: "var(--text-secondary)" }}>You've declined this invitation.</p>
        <div style={{ display: "flex", gap: "8px", justifyContent: "center", marginTop: "12px" }}>
          <button
            onClick={() => respond("ACCEPTED")}
            disabled={loading}
            style={{ fontSize: "13px", color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            Changed your mind?
          </button>
          <button
            onClick={() => respond("TENTATIVE")}
            disabled={loading}
            style={{ fontSize: "13px", color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            Maybe
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: "12px", justifyContent: "center", padding: "24px 0" }}>
      <button
        onClick={() => respond("ACCEPTED")}
        disabled={loading}
        style={{
          padding: "12px 24px", borderRadius: "8px", border: "none",
          background: "var(--color-green-600, #16a34a)", color: "#fff",
          fontSize: "15px", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer"
        }}
      >
        Accept
      </button>
      <button
        onClick={() => respond("TENTATIVE")}
        disabled={loading}
        style={{
          padding: "12px 24px", borderRadius: "8px", border: "1px solid var(--border)",
          background: "var(--bg-card)", color: "var(--text-secondary)",
          fontSize: "15px", fontWeight: 500, cursor: loading ? "not-allowed" : "pointer"
        }}
      >
        Maybe
      </button>
      <button
        onClick={() => respond("DECLINED")}
        disabled={loading}
        style={{
          padding: "12px 24px", borderRadius: "8px", border: "1px solid var(--border)",
          background: "var(--bg-card)", color: "var(--text-primary)",
          fontSize: "15px", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer"
        }}
      >
        Decline
      </button>
    </div>
  );
}
