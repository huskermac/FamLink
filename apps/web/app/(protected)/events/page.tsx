"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyFamilies } from "@/lib/api/family";
import { getEvents } from "@/lib/api/events";
import { initSocket, useSocketEvent } from "@/lib/socket";
import { EventCard } from "@/components/events/EventCard";

function SkeletonCard() {
  return <div className="h-20 animate-pulse rounded-lg border border-slate-700 bg-slate-800/40" />;
}

const DAY_OPTIONS = [30, 60, 90] as const;
type DayOption = (typeof DAY_OPTIONS)[number];

export default function EventsPage() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [days, setDays] = useState<DayOption>(90);

  // Resolve the user's active family
  const familiesQuery = useQuery({
    queryKey: ["families"],
    queryFn: () => getMyFamilies(getToken)
  });

  useEffect(() => {
    const memberships = familiesQuery.data;
    if (memberships && memberships.length > 0) {
      setFamilyId(memberships[0].familyGroup.id);
    }
  }, [familiesQuery.data]);

  // Load events once we have a familyId
  const eventsQuery = useQuery({
    queryKey: ["events", familyId, days],
    queryFn: () => getEvents(familyId!, getToken, { days }),
    enabled: !!familyId
  });

  // Initialize socket for real-time updates
  useEffect(() => {
    let cancelled = false;
    getToken().then((token) => {
      if (!cancelled && token) initSocket(token);
    });
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  // Prepend new events as they arrive — invalidate all day-window caches for this family
  useSocketEvent<"event:created">("event:created", (payload) => {
    if (!familyId) return;
    queryClient.invalidateQueries({ queryKey: ["events", familyId] });
  });

  const isLoading = familiesQuery.isLoading || (!!familyId && eventsQuery.isLoading);
  const isError = familiesQuery.isError || eventsQuery.isError;
  const events = eventsQuery.data?.events ?? [];
  const hasNoFamily = !familiesQuery.isLoading && !familiesQuery.isError && familyId === null;

  if (hasNoFamily) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-slate-100">Events</h1>
        <p className="mt-4 text-sm text-slate-400">You haven&apos;t joined a family yet.</p>
        <Link href="/onboarding" className="mt-3 inline-block text-sm text-indigo-400 hover:text-indigo-300">
          Get started with onboarding →
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <h1 className="text-xl font-semibold text-slate-100">Events</h1>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-slate-100">Events</h1>
        <p className="mt-4 text-sm text-red-400">Failed to load events. Please try again.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-100">Events</h1>
        <Link
          href="/events/new"
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
        >
          Create Event
        </Link>
      </div>
      <div style={{ display: "flex", gap: "4px" }}>
        {DAY_OPTIONS.map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            style={{
              padding: "4px 12px",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: 500,
              border: "1px solid",
              cursor: "pointer",
              background: days === d ? "#6366f1" : "transparent",
              borderColor: days === d ? "#6366f1" : "#475569",
              color: days === d ? "#fff" : "#94a3b8",
            }}
          >
            {d}d
          </button>
        ))}
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-slate-400">No upcoming events.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
