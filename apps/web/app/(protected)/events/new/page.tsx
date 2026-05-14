"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { getMyFamilies } from "@/lib/api/family";
import { createEvent } from "@/lib/api/events";
import type { EventType, EventVisibility } from "@/lib/api/events";
import { EVENT_TYPE_CONFIG } from "@/lib/eventTypes";

const VISIBILITY_OPTIONS: { value: EventVisibility; label: string; desc: string }[] = [
  { value: "BROADCAST", label: "Broadcast", desc: "Everyone in the family sees this" },
  { value: "OPEN",      label: "Open",      desc: "Invited guests; they can bring others" },
  { value: "PRIVATE",   label: "Private",   desc: "Invited guests only" },
];

const EVENT_TYPES = (["HOLIDAY", "BIRTHDAY", "SPORTS", "SCHOOL", "OTHER"] as const);

export default function NewEventPage() {
  const router = useRouter();
  const { getToken } = useAuth();

  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [eventType, setEventType] = useState<EventType>("OTHER");
  const [eventVisibility, setEventVisibility] = useState<EventVisibility>("BROADCAST");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const familiesQuery = useQuery({
    queryKey: ["families"],
    queryFn: () => getMyFamilies(getToken)
  });

  const familyId = familiesQuery.data?.[0]?.familyGroup.id ?? null;

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
    const startDate = new Date(startTime);
    if (startDate <= new Date()) {
      setError("Start time must be in the future.");
      return;
    }
    if (!familyId) {
      setError("Could not resolve your family. Please try again.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await createEvent(
        familyId,
        {
          title: title.trim(),
          startAt: startDate.toISOString(),
          ...(endTime ? { endAt: new Date(endTime).toISOString() } : {}),
          ...(location.trim() ? { locationName: location.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          eventType,
          eventVisibility,
        },
        getToken
      );
      router.push(`/events/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create event.");
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

  return (
    <div className="flex flex-col gap-6 p-6 max-w-lg">
      <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Create Event</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">

        {/* Title */}
        <div className="flex flex-col gap-1">
          <label htmlFor="title" style={labelStyle}>
            Title <span className="text-red-400">*</span>
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Summer BBQ"
            style={inputStyle}
          />
        </div>

        {/* Event type */}
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

        {/* Visibility */}
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

        {/* Start time */}
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

        {/* End time */}
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

        {/* Location */}
        <div className="flex flex-col gap-1">
          <label htmlFor="location" style={labelStyle}>
            Location <span style={{ color: "var(--text-muted)" }}>(optional)</span>
          </label>
          <input
            id="location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="123 Main St"
            style={inputStyle}
          />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1">
          <label htmlFor="description" style={labelStyle}>
            Description <span style={{ color: "var(--text-muted)" }}>(optional)</span>
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Tell people what to expect…"
            style={{ ...inputStyle, resize: "none" }}
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting || familiesQuery.isLoading}
          className="rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
          style={{ background: "var(--accent)" }}
        >
          {submitting ? "Creating…" : "Create Event"}
        </button>
      </form>
    </div>
  );
}
