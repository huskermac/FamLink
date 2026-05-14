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
  return <div className="h-20 animate-pulse rounded-lg" style={{ border: "1px solid var(--border)", background: "var(--bg-card)" }} />;
}

const DAY_OPTIONS = [30, 60, 90] as const;
type DayOption = (typeof DAY_OPTIONS)[number];

export default function EventsPage() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [days, setDays] = useState<DayOption>(90);

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

  const eventsQuery = useQuery({
    queryKey: ["events", familyId, days],
    queryFn: () => getEvents(familyId!, getToken, { days }),
    enabled: !!familyId
  });

  useEffect(() => {
    let cancelled = false;
    getToken().then((token) => {
      if (!cancelled && token) initSocket(token);
    });
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  useSocketEvent<"event:created">("event:created", () => {
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
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Events</h1>
        <p className="mt-4 text-sm" style={{ color: "var(--text-secondary)" }}>You haven&apos;t joined a family yet.</p>
        <Link href="/onboarding" className="mt-3 inline-block text-sm" style={{ color: "var(--accent)" }}>
          Get started with onboarding →
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Events</h1>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Events</h1>
        <p className="mt-4 text-sm text-red-400">Failed to load events. Please try again.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Events</h1>
        <Link
          href="/events/new"
          className="rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors"
          style={{ background: "var(--accent)" }}
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
              background: days === d ? "var(--accent)" : "transparent",
              borderColor: days === d ? "var(--accent)" : "var(--border)",
              color: days === d ? "#fff" : "var(--text-secondary)",
            }}
          >
            {d}d
          </button>
        ))}
      </div>
      {events.length === 0 ? (
        <div style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
          <p>No events in the next {days} days.</p>
          <Link href="/events/new" style={{ color: "var(--accent)", marginTop: "8px", display: "inline-block" }}>
            Create an event →
          </Link>
        </div>
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
