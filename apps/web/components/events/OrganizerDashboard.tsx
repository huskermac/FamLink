"use client";

import { useState } from "react";
import { useSocketEvent } from "@/lib/socket";
import type { RsvpSummary } from "@/lib/api/events";

interface Props {
  eventId: string;
  initialRsvpSummary: RsvpSummary;
}

const STATUS_LABELS = ["YES", "NO", "MAYBE", "PENDING"] as const;

const STATUS_COLORS: Record<string, string> = {
  YES: "text-emerald-400",
  NO: "text-red-400",
  MAYBE: "text-amber-400",
  PENDING: "text-slate-400"
};

export function OrganizerDashboard({ eventId, initialRsvpSummary }: Props) {
  const [counts, setCounts] = useState<RsvpSummary>(initialRsvpSummary);

  useSocketEvent<"rsvp:updated">("rsvp:updated", (payload) => {
    if (payload.eventId !== eventId) return;
    // Re-fetch would be most accurate, but for live counter we bump the
    // new status. We can't know the previous status from the socket payload,
    // so we decrement PENDING as a best-effort (most RSVPs start PENDING).
    setCounts((prev) => {
      const next = { ...prev };
      const status = payload.status as keyof RsvpSummary;
      if (status in next) {
        next[status] = (next[status] ?? 0) + 1;
        if (next.PENDING > 0) next.PENDING -= 1;
      }
      return next;
    });
  });

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Live RSVP Counts
      </h3>
      <div className="grid grid-cols-4 gap-3">
        {STATUS_LABELS.map((status) => (
          <div
            key={status}
            className="flex flex-col items-center rounded-lg border border-slate-700 bg-slate-800/60 p-3"
          >
            <span className={`text-2xl font-bold ${STATUS_COLORS[status]}`}>
              {counts[status]}
            </span>
            <span className="mt-1 text-xs text-slate-500 capitalize">
              {status.charAt(0) + status.slice(1).toLowerCase()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
