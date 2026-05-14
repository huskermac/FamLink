import Link from "next/link";
import type { EventSummary } from "@/lib/api/events";
import { EVENT_TYPE_CONFIG } from "@/lib/eventTypes";

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
  const cfg = EVENT_TYPE_CONFIG[event.eventType ?? "OTHER"];

  return (
    <Link
      href={`/events/${event.id}`}
      style={{
        display: "flex",
        borderRadius: "8px",
        border: "1px solid var(--border)",
        background: "var(--bg-card)",
        textDecoration: "none",
        overflow: "hidden",
      }}
    >
      {/* Left accent bar */}
      <div style={{ width: "3px", flexShrink: 0, background: cfg.bar }} />

      {/* Card body */}
      <div style={{
        flex: 1,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
          <span style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.3 }}>
            {event.title}
          </span>
          <span style={{
            flexShrink: 0,
            borderRadius: "9999px",
            background: cfg.badgeBg,
            color: cfg.badgeText,
            padding: "2px 8px",
            fontSize: "11px",
            fontWeight: 500,
          }}>
            {cfg.label}
          </span>
        </div>
        <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          {formatDate(event.startAt)} at {formatTime(event.startAt)}
        </span>
        {event.locationName && (
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{event.locationName}</span>
        )}
      </div>
    </Link>
  );
}
