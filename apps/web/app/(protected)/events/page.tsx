"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyFamilies } from "@/lib/api/family";
import { getEvents, type EventSummary } from "@/lib/api/events";
import { initSocket, useSocketEvent } from "@/lib/socket";
import { EventCard } from "@/components/events/EventCard";

function SkeletonCard() {
  return <div className="h-20 animate-pulse rounded-lg border border-slate-700 bg-slate-800/40" />;
}

export default function EventsPage() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [familyId, setFamilyId] = useState<string | null>(null);

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
    queryKey: ["events", familyId],
    queryFn: () => getEvents(familyId!, getToken),
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

  // Prepend new events as they arrive
  useSocketEvent<"event:created">("event:created", (payload) => {
    if (!familyId) return;
    queryClient.setQueryData<{ events: EventSummary[] }>(
      ["events", familyId],
      (prev) => {
        if (!prev) return prev;
        const newEvent: EventSummary = {
          id: payload.id,
          familyGroupId: familyId,
          title: payload.title,
          startAt: payload.startTime,
          endAt: null,
          locationName: null,
          isBirthdayEvent: false
        };
        // Avoid duplicates
        const alreadyPresent = prev.events.some((e) => e.id === payload.id);
        if (alreadyPresent) return prev;
        return { ...prev, events: [newEvent, ...prev.events] };
      }
    );
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
