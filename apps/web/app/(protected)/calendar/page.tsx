"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { getMyFamilies } from "@/lib/api/family";
import { getCalendarEvents, getUpcomingDigest, type CalendarEvent } from "@/lib/api/calendar";
import { CalendarView } from "@/components/calendar/CalendarView";
import { BirthdayPopover } from "@/components/calendar/BirthdayPopover";
import { UpcomingDigest } from "@/components/calendar/UpcomingDigest";

function parseBirthdayName(title: string): string {
  return title.replace(/'s Birthday$/i, "").trim();
}

export default function CalendarPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [rangeStart, setRangeStart] = useState<Date>(() => new Date());
  const [selectedBirthday, setSelectedBirthday] = useState<{ name: string } | null>(null);

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

  const calendarQuery = useQuery({
    queryKey: ["calendar", familyId, rangeStart.getFullYear(), rangeStart.getMonth()],
    queryFn: () => getCalendarEvents(familyId!, rangeStart, getToken),
    enabled: !!familyId
  });

  const digestQuery = useQuery({
    queryKey: ["calendarDigest", familyId],
    queryFn: () => getUpcomingDigest(familyId!, getToken),
    enabled: !!familyId
  });

  function handleRangeChange(start: Date, _end: Date) {
    setRangeStart(start);
  }

  function handleEventClick(event: CalendarEvent) {
    if (event.type === "BIRTHDAY") {
      setSelectedBirthday({ name: parseBirthdayName(event.title) });
    } else if (event.eventId) {
      router.push(`/events/${event.eventId}`);
    }
  }

  const events = calendarQuery.data ?? [];
  const digest = digestQuery.data ?? { events: [], birthdays: [], generatedAt: "" };

  if (familiesQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex gap-6 p-6">
      <div className="flex-1 min-w-0">
        <h1 className="text-xl font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Family Calendar</h1>
        {calendarQuery.isLoading ? (
          <div className="h-[600px] animate-pulse rounded-lg" style={{ background: "var(--bg-card)" }} />
        ) : events.length === 0 && !calendarQuery.isLoading ? (
          <div>
            <CalendarView
              events={events}
              onRangeChange={handleRangeChange}
              onEventClick={handleEventClick}
            />
            <p className="mt-4 text-sm" style={{ color: "var(--text-secondary)" }}>No events to show.</p>
          </div>
        ) : (
          <CalendarView
            events={events}
            onRangeChange={handleRangeChange}
            onEventClick={handleEventClick}
          />
        )}
      </div>

      {digestQuery.data && (
        <UpcomingDigest digest={digest} />
      )}

      {selectedBirthday && (
        <BirthdayPopover
          person={selectedBirthday}
          onClose={() => setSelectedBirthday(null)}
        />
      )}
    </div>
  );
}
