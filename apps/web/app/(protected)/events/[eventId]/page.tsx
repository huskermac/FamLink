"use client";

import { useState, use } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { getEventDetails } from "@/lib/api/events";
import { RsvpButton } from "@/components/events/RsvpButton";
import { OrganizerDashboard } from "@/components/events/OrganizerDashboard";
import { PhotoGallery } from "@/components/photos/PhotoGallery";

type Params = { eventId: string };

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

type Tab = "details" | "attendees" | "photos" | "organizer";

export default function EventDetailPage({ params }: { params: Promise<Params> }) {
  const { eventId } = use(params);
  const { getToken } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("details");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => getEventDetails(eventId, getToken)
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <div className="h-6 w-48 animate-pulse rounded" style={{ background: "var(--border)" }} />
        <div className="h-4 w-32 animate-pulse rounded" style={{ background: "var(--bg-card)" }} />
        <div className="h-4 w-40 animate-pulse rounded" style={{ background: "var(--bg-card)" }} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-400">Failed to load event. Please try again.</p>
      </div>
    );
  }

  const { event, rsvps, eventItems } = data;

  const isOrganizer = true;

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "details", label: "Details", show: true },
    { id: "attendees", label: "Attendees", show: true },
    { id: "photos", label: "Photos", show: true },
    { id: "organizer", label: "Organizer", show: isOrganizer }
  ];

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>{event.title}</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>{formatDateTime(event.startAt)}</p>
        {event.locationName && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>{event.locationName}</p>
        )}
      </div>

      {/* RSVP buttons */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Your RSVP</p>
        <RsvpButton eventId={eventId} currentStatus={null} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1" style={{ borderBottom: "1px solid var(--border)" }}>
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className="px-4 py-2 text-sm font-medium transition-colors"
              style={activeTab === t.id
                ? { borderBottom: "2px solid var(--accent)", color: "var(--accent)", marginBottom: "-1px" }
                : { color: "var(--text-secondary)" }
              }
            >
              {t.label}
            </button>
          ))}
      </div>

      {/* Tab content */}
      {activeTab === "details" && (
        <div className="flex flex-col gap-3">
          {event.description && (
            <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{event.description}</p>
          )}
          {event.endAt && (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Ends: {formatDateTime(event.endAt)}</p>
          )}
          {event.locationAddress && (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{event.locationAddress}</p>
          )}
          {eventItems.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Items</p>
              {eventItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-md px-3 py-2"
                  style={{ border: "1px solid var(--border)", background: "var(--bg-card)" }}
                >
                  <span className="text-sm" style={{ color: "var(--text-primary)" }}>{item.name}</span>
                  {item.quantity && (
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>{item.quantity}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "attendees" && (
        <div className="flex flex-col gap-4">
          {(["YES", "NO", "MAYBE", "PENDING"] as const).map((status) => {
            const count = rsvps[status];
            return (
              <div key={status} className="flex flex-col gap-1">
                <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  {status === "YES" ? "Going" : status === "NO" ? "Not going" : status === "MAYBE" ? "Maybe" : "Pending"}{" "}
                  <span style={{ color: "var(--text-muted)" }}>({count})</span>
                </p>
                {count === 0 && (
                  <p className="text-xs italic" style={{ color: "var(--text-muted)" }}>None yet</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {activeTab === "photos" && (
        <PhotoGallery eventId={eventId} />
      )}

      {activeTab === "organizer" && (
        <OrganizerDashboard eventId={eventId} initialRsvpSummary={rsvps} />
      )}
    </div>
  );
}
