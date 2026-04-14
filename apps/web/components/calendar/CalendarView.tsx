"use client";

import { useCallback } from "react";
import { Calendar, dateFnsLocalizer, type View } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import type { CalendarEvent } from "@/lib/api/calendar";

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: { "en-US": enUS }
});

const EVENT_COLORS: Record<string, string> = {
  EVENT: "#4f46e5",
  BIRTHDAY: "#7c3aed"
};

interface Props {
  events: CalendarEvent[];
  onRangeChange: (start: Date, end: Date) => void;
  onEventClick: (event: CalendarEvent) => void;
}

function normalizeRange(range: Date[] | { start: Date; end: Date }): { start: Date; end: Date } {
  if (Array.isArray(range)) {
    return { start: range[0], end: range[range.length - 1] };
  }
  return range;
}

export function CalendarView({ events, onRangeChange, onEventClick }: Props) {
  const handleRangeChange = useCallback(
    (range: Date[] | { start: Date; end: Date }, _view?: View) => {
      const { start, end } = normalizeRange(range);
      onRangeChange(start, end);
    },
    [onRangeChange]
  );

  return (
    <div style={{ height: 600 }}>
      <Calendar<CalendarEvent>
        localizer={localizer}
        events={events}
        defaultView="month"
        views={["month", "week"]}
        startAccessor="start"
        endAccessor="end"
        titleAccessor="title"
        onSelectEvent={onEventClick}
        onRangeChange={handleRangeChange}
        eventPropGetter={(event: CalendarEvent) => ({
          style: {
            backgroundColor: EVENT_COLORS[event.type] ?? EVENT_COLORS.EVENT,
            border: "none",
            borderRadius: "4px"
          }
        })}
      />
    </div>
  );
}
