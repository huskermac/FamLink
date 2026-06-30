"use client";

import { useState, use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getEventDetails, updateEvent, isForeignEventDTO } from "@/lib/api/events";
import type { EventType, EventVisibility } from "@/lib/api/events";
import { EVENT_TYPE_CONFIG } from "@/lib/eventTypes";

type Params = { eventId: string };

const VISIBILITY_OPTIONS: { value: EventVisibility; label: string; desc: string }[] = [
  { value: "BROADCAST", label: "Broadcast", desc: "Everyone in the family sees this" },
  { value: "OPEN",      label: "Open",      desc: "Invited guests; they can bring others" },
  { value: "PRIVATE",   label: "Private",   desc: "Invited guests only" },
];

const EVENT_TYPES = (["HOLIDAY", "PARTY", "MILESTONE", "SPORTS", "SCHOOL", "OTHER"] as const);

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EditEventPage({ params }: { params: Promise<Params> }) {
  const { eventId } = use(params);
  const router = useRouter();
  const { getToken } = useAuth();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => getEventDetails(eventId, getToken)
  });

  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [eventType, setEventType] = useState<EventType>("OTHER");
  const [eventVisibility, setEventVisibility] = useState<EventVisibility>("BROADCAST");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (data && !isForeignEventDTO(data) && !initialized) {
      const { event } = data;
      setTitle(event.title);
      setStartTime(toDatetimeLocal(event.startAt));
      setEndTime(event.endAt ? toDatetimeLocal(event.endAt) : "");
      setLocation(event.locationName ?? "");
      setDescription(event.description ?? "");
      setEventType((event.eventType ?? "OTHER") as EventType);
      setEventVisibility((event.eventVisibility ?? "BROADCAST") as EventVisibility);
      setInitialized(true);
    }
  }, [data, initialized]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!startTime) {
      setError("Start time is required.");
      return;
    }

    setSubmitting(true);
    try {
      await updateEvent(
        eventId,
        {
          title: title.trim(),
          startAt: new Date(startTime).toISOString(),
          ...(endTime ? { endAt: new Date(endTime).toISOString() } : {}),
          ...(location.trim() ? { locationName: location.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          eventType,
          eventVisibility,
        },
        getToken
      );
      await queryClient.invalidateQueries({ queryKey: ["event", eventId] });
      await queryClient.invalidateQueries({ queryKey: ["events"] });
      router.push(`/events/${eventId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes.");
      setSubmitting(false);
    }
  }

  const inputStyle = {
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "var(--bg-card)",
    padding: "8px 12px",
    fontSize: "14px",
    color: "var(--text-primary)",
    width: "100%",
    outline: "none",
  };

  const labelStyle = {
    fontSize: "13px",
    fontWeight: 500 as const,
    color: "var(--text-secondary)",
  };

  if (isLoading || !initialized) {
    return (
      <div className="flex flex-col gap-4 p-6 max-w-lg">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded" style={{ background: "var(--border)" }} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-400">Failed to load event. Please try again.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-lg">
      <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Edit Event</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">

        <div className="flex flex-col gap-1">
          <label htmlFor="title" style={labelStyle}>
            Title <span className="text-red-400">*</span>
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span style={labelStyle}>Event type</span>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {EVENT_TYPES.map((t) => {
              const cfg = EVENT_TYPE_CONFIG[t];
              const selected = eventType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setEventType(t)}
                  style={{
                    padding: "4px 12px",
                    borderRadius: "9999px",
                    fontSize: "12px",
                    fontWeight: 500,
                    border: `2px solid ${selected ? cfg.bar : "var(--border)"}`,
                    background: selected ? cfg.badgeBg : "transparent",
                    color: selected ? cfg.badgeText : "var(--text-muted)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                  }}
                >
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: cfg.bar, display: "inline-block", flexShrink: 0 }} />
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span style={labelStyle}>Who can see this?</span>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {VISIBILITY_OPTIONS.map(({ value, label, desc }) => (
              <label key={value} style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="eventVisibility"
                  value={value}
                  checked={eventVisibility === value}
                  onChange={() => setEventVisibility(value)}
                  style={{ marginTop: "2px", flexShrink: 0 }}
                />
                <span>
                  <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>{label}</span>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "6px" }}>{desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="startTime" style={labelStyle}>
            Start time <span className="text-red-400">*</span>
          </label>
          <input
            id="startTime"
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="endTime" style={labelStyle}>
            End time <span style={{ color: "var(--text-muted)" }}>(optional)</span>
          </label>
          <input
            id="endTime"
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="location" style={labelStyle}>
            Location <span style={{ color: "var(--text-muted)" }}>(optional)</span>
          </label>
          <input
            id="location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="description" style={labelStyle}>
            Description <span style={{ color: "var(--text-muted)" }}>(optional)</span>
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "none" }}
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {submitting ? "Saving…" : "Save Changes"}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/events/${eventId}`)}
            className="rounded-md px-4 py-2 text-sm font-medium transition-colors"
            style={{ border: "1px solid var(--border)", color: "var(--text-secondary)", background: "transparent" }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
