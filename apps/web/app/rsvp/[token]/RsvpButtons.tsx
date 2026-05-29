"use client";
import { useState } from "react";
import { submitGuestRsvp } from "@/lib/api/events";

type RsvpStatus = "ACCEPTED" | "TENTATIVE" | "DECLINED";

interface Props {
  token: string;
  initialStatus: string;
}

const OPTIONS: Array<{ value: RsvpStatus; label: string }> = [
  { value: "ACCEPTED",  label: "Accept" },
  { value: "TENTATIVE", label: "Maybe" },
  { value: "DECLINED",  label: "Decline" },
];

const STATUS_LABEL: Record<RsvpStatus, string> = {
  ACCEPTED:  "You're going!",
  TENTATIVE: "You might be going.",
  DECLINED:  "You've declined.",
};

export function RsvpButtons({ token, initialStatus }: Props) {
  const [status, setStatus]   = useState(initialStatus);
  const [loading, setLoading] = useState(false);

  async function respond(next: RsvpStatus) {
    if (next === status || loading) return;
    setLoading(true);
    try {
      const result = await submitGuestRsvp(token, next);
      setStatus(result.status);
    } finally {
      setLoading(false);
    }
  }

  const confirmedStatus = status as RsvpStatus;
  const isConfirmed = status === "ACCEPTED" || status === "TENTATIVE" || status === "DECLINED";

  return (
    <div style={{ padding: "24px 0" }}>
      {isConfirmed && (
        <p style={{ textAlign: "center", fontSize: "13px", color: "var(--text-muted)", marginBottom: "16px" }}>
          {STATUS_LABEL[confirmedStatus]}
        </p>
      )}
      <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
        {OPTIONS.map(opt => {
          const isActive = opt.value === status;
          return (
            <button
              key={opt.value}
              onClick={() => respond(opt.value)}
              disabled={loading}
              style={{
                padding: "12px 24px",
                borderRadius: "8px",
                border: isActive ? "2px solid var(--color-primary, #6366f1)" : "1px solid var(--border)",
                background: isActive ? "var(--color-primary, #6366f1)" : "var(--bg-card)",
                color: isActive ? "#fff" : "var(--text-primary)",
                fontSize: "15px",
                fontWeight: 600,
                cursor: isActive || loading ? "default" : "pointer",
                opacity: loading && !isActive ? 0.6 : 1,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
