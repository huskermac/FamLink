import Link from "next/link";
import type { EventSummary } from "@/lib/api/events";

interface Props {
  event: EventSummary;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });
}

export function EventCard({ event }: Props) {
  return (
    <Link
      href={`/events/${event.id}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        borderRadius: "8px",
        border: "1px solid #334155",
        background: "rgba(30,41,59,0.6)",
        padding: "16px",
        textDecoration: "none",
      }}
    >
      <span style={{ fontSize: "15px", fontWeight: 600, color: "#e2e8f0" }}>{event.title}</span>
      <span style={{ fontSize: "13px", color: "#94a3b8" }}>
        {formatDate(event.startAt)} at {formatTime(event.startAt)}
      </span>
      {event.locationName && (
        <span style={{ fontSize: "12px", color: "#64748b" }}>{event.locationName}</span>
      )}
      {event.isBirthdayEvent && (
        <span style={{
          marginTop: "4px",
          alignSelf: "flex-start",
          borderRadius: "9999px",
          background: "rgba(49,46,129,0.5)",
          padding: "2px 8px",
          fontSize: "12px",
          color: "#a5b4fc",
        }}>
          Birthday
        </span>
      )}
    </Link>
  );
}
