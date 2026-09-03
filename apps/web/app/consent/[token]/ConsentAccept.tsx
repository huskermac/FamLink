"use client";
import { useState } from "react";
import { acceptConsentRequest } from "@/lib/api/consent";

interface Props {
  token: string;
  initialStatus: string;
}

export function ConsentAccept({ token, initialStatus }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [loading, setLoading] = useState(false);
  const [resolvedMessage, setResolvedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await acceptConsentRequest(token);
      if (result.granted) {
        setStatus("ACCEPTED");
      } else {
        setResolvedMessage("This request is no longer available.");
        setStatus(result.status);
      }
    } catch {
      // A network or malformed-response failure must not become an unhandled rejection.
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (status === "ACCEPTED") {
    return (
      <p style={{ textAlign: "center", fontSize: "14px", color: "var(--text-secondary)", padding: "24px 0" }}>
        You are now a member.
      </p>
    );
  }

  if (status === "DECLINED") {
    return (
      <p style={{ textAlign: "center", fontSize: "14px", color: "var(--text-muted)", padding: "24px 0" }}>
        This request was declined.
      </p>
    );
  }

  return (
    <div style={{ padding: "24px 0" }}>
      {resolvedMessage && (
        <p style={{ textAlign: "center", fontSize: "13px", color: "var(--text-muted)", marginBottom: "16px" }}>
          {resolvedMessage}
        </p>
      )}
      {error && (
        <p style={{ textAlign: "center", fontSize: "13px", color: "#dc2626", marginBottom: "16px" }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <button
          onClick={accept}
          disabled={loading || resolvedMessage !== null}
          style={{
            padding: "12px 28px",
            borderRadius: "8px",
            border: "none",
            background: "var(--color-primary, #6366f1)",
            color: "#fff",
            fontSize: "15px",
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer"
          }}
        >
          {loading ? "Accepting…" : "Accept"}
        </button>
      </div>
    </div>
  );
}
