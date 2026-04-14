"use client";

import { useState, use } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { getEventDetails } from "@/lib/api/events";
import { RsvpButton } from "@/components/events/RsvpButton";
import { OrganizerDashboard } from "@/components/events/OrganizerDashboard";

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

type Tab = "details" | "attendees" | "organizer";

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
        <div className="h-6 w-48 animate-pulse rounded bg-slate-700" />
        <div className="h-4 w-32 animate-pulse rounded bg-slate-800" />
        <div className="h-4 w-40 animate-pulse rounded bg-slate-800" />
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

  // Determine if the current user is the organizer.
  // We compare against the Clerk userId, but the event stores a personId.
  // For now, the organizer tab is available to all authenticated members
  // (the API enforces actual permissions server-side).
  const isOrganizer = true; // Phase 2: show to all members; API guards writes

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "details", label: "Details", show: true },
    { id: "attendees", label: "Attendees", show: true },
    { id: "organizer", label: "Organizer", show: isOrganizer }
  ];

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">{event.title}</h1>
        <p className="mt-1 text-sm text-slate-400">{formatDateTime(event.startAt)}</p>
        {event.locationName && (
          <p className="text-sm text-slate-500">{event.locationName}</p>
        )}
      </div>

      {/* RSVP buttons */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Your RSVP</p>
        <RsvpButton eventId={eventId} currentStatus={null} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-700">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={[
                "px-4 py-2 text-sm font-medium transition-colors",
                activeTab === t.id
                  ? "border-b-2 border-indigo-500 text-indigo-400"
                  : "text-slate-400 hover:text-slate-200"
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
      </div>

      {/* Tab content */}
      {activeTab === "details" && (
        <div className="flex flex-col gap-3">
          {event.description && (
            <p className="text-sm text-slate-300 whitespace-pre-wrap">{event.description}</p>
          )}
          {event.endAt && (
            <p className="text-sm text-slate-400">Ends: {formatDateTime(event.endAt)}</p>
          )}
          {event.locationAddress && (
            <p className="text-sm text-slate-400">{event.locationAddress}</p>
          )}
          {eventItems.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Items</p>
              {eventItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2"
                >
                  <span className="text-sm text-slate-200">{item.name}</span>
                  {item.quantity && (
                    <span className="text-xs text-slate-500">{item.quantity}</span>
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
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {status === "YES" ? "Going" : status === "NO" ? "Not going" : status === "MAYBE" ? "Maybe" : "Pending"}{" "}
                  <span className="text-slate-600">({count})</span>
                </p>
                {count === 0 && (
                  <p className="text-xs text-slate-600 italic">None yet</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {activeTab === "organizer" && (
        <OrganizerDashboard eventId={eventId} initialRsvpSummary={rsvps} />
      )}
    </div>
  );
}
