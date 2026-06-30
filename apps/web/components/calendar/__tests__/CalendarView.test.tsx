import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CalendarView } from "@/components/calendar/CalendarView";
import type { CalendarEvent } from "@/lib/api/calendar";

// Mock the entire react-big-calendar module so tests run in jsdom
vi.mock("react-big-calendar", () => ({
  Calendar: ({
    events,
    onSelectEvent,
    onRangeChange
  }: {
    events: CalendarEvent[];
    onSelectEvent: (e: CalendarEvent) => void;
    onRangeChange: (range: { start: Date; end: Date }) => void;
  }) => (
    <div data-testid="rbc-calendar">
      {events.map((e) => (
        <button
          key={e.id}
          data-testid={`event-${e.id}`}
          data-type={e.type}
          onClick={() => onSelectEvent(e)}
        >
          {e.title}
        </button>
      ))}
      <button
        data-testid="trigger-range-change"
        onClick={() =>
          onRangeChange({ start: new Date("2026-08-01"), end: new Date("2026-08-31") })
        }
      >
        Change range
      </button>
    </div>
  ),
  dateFnsLocalizer: vi.fn(() => ({}))
}));

vi.mock("date-fns", () => ({
  format: vi.fn(),
  parse: vi.fn(),
  startOfWeek: vi.fn(),
  getDay: vi.fn()
}));

vi.mock("date-fns/locale", () => ({ enUS: {} }));

const eventEvent: CalendarEvent = {
  id: "evt1",
  title: "Summer BBQ",
  start: new Date("2026-07-04T17:00:00Z"),
  end: new Date("2026-07-04T20:00:00Z"),
  type: "EVENT",
  eventId: "evt1"
};

const birthdayEvent: CalendarEvent = {
  id: "birthday-p1-2026",
  title: "Alice's Birthday",
  start: new Date("2026-07-15T00:00:00Z"),
  end: new Date("2026-07-16T00:00:00Z"),
  type: "BIRTHDAY"
};

describe("CalendarView", () => {
  it("renders without crashing with an empty events array", () => {
    render(
      <CalendarView events={[]} onRangeChange={vi.fn()} onEventClick={vi.fn()} />
    );
    expect(screen.getByTestId("rbc-calendar")).toBeInTheDocument();
  });

  it("renders EVENT type event title", () => {
    render(
      <CalendarView events={[eventEvent]} onRangeChange={vi.fn()} onEventClick={vi.fn()} />
    );
    expect(screen.getByText("Summer BBQ")).toBeInTheDocument();
  });

  it("renders BIRTHDAY type event title", () => {
    render(
      <CalendarView events={[birthdayEvent]} onRangeChange={vi.fn()} onEventClick={vi.fn()} />
    );
    expect(screen.getByText("Alice's Birthday")).toBeInTheDocument();
  });

  it("calls onEventClick when an event is clicked", () => {
    const onEventClick = vi.fn();
    render(
      <CalendarView events={[eventEvent]} onRangeChange={vi.fn()} onEventClick={onEventClick} />
    );
    fireEvent.click(screen.getByTestId("event-evt1"));
    expect(onEventClick).toHaveBeenCalledWith(eventEvent);
  });

  it("calls onRangeChange when navigation changes the visible range", () => {
    const onRangeChange = vi.fn();
    render(
      <CalendarView events={[]} onRangeChange={onRangeChange} onEventClick={vi.fn()} />
    );
    fireEvent.click(screen.getByTestId("trigger-range-change"));
    expect(onRangeChange).toHaveBeenCalledWith(
      new Date("2026-08-01"),
      new Date("2026-08-31")
    );
  });
});
