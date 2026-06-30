import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CalendarEvent } from "@/lib/api/calendar";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush })
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue("token") })
}));

// Capture query handlers so we can feed data
const mockUseQuery = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryFn: () => unknown }) => mockUseQuery(opts),
  useQueryClient: () => ({ invalidateQueries: vi.fn() })
}));

vi.mock("@/lib/api/family", () => ({ getMyFamilies: vi.fn() }));
vi.mock("@/lib/api/calendar", () => ({
  getCalendarEvents: vi.fn(),
  getUpcomingDigest: vi.fn()
}));

// Capture CalendarView's onEventClick and onRangeChange so tests can invoke them
let capturedOnEventClick: ((e: CalendarEvent) => void) | null = null;
let capturedOnRangeChange: ((start: Date, end: Date) => void) | null = null;

vi.mock("@/components/calendar/CalendarView", () => ({
  CalendarView: ({
    onEventClick,
    onRangeChange
  }: {
    onEventClick: (e: CalendarEvent) => void;
    onRangeChange: (start: Date, end: Date) => void;
  }) => {
    capturedOnEventClick = onEventClick;
    capturedOnRangeChange = onRangeChange;
    return <div data-testid="calendar-view" />;
  }
}));

vi.mock("@/components/calendar/BirthdayPopover", () => ({
  BirthdayPopover: ({ person }: { person: { name: string } }) => (
    <div data-testid="birthday-popover">{person.name}</div>
  )
}));

vi.mock("@/components/calendar/UpcomingDigest", () => ({
  UpcomingDigest: () => <div data-testid="upcoming-digest" />
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

const FAMILY_ID = "fam1";

function setupQueries({
  events = [] as CalendarEvent[],
  withDigest = true
} = {}) {
  mockUseQuery.mockImplementation((opts: { queryKey: unknown[] }) => {
    const key = opts.queryKey[0];
    if (key === "families") {
      return { data: [{ familyGroup: { id: FAMILY_ID } }], isLoading: false, isError: false };
    }
    if (key === "calendar") {
      return { data: events, isLoading: false, isError: false };
    }
    if (key === "calendarDigest") {
      return withDigest
        ? { data: { events: [], birthdays: [], generatedAt: "" }, isLoading: false, isError: false }
        : { data: undefined, isLoading: false, isError: false };
    }
    return { data: undefined, isLoading: false, isError: false };
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockPush.mockClear();
  capturedOnEventClick = null;
  capturedOnRangeChange = null;
});

describe("CalendarPage", () => {
  it("navigates to /events/[id] when an EVENT type event is clicked", async () => {
    setupQueries();
    const { default: CalendarPage } = await import("@/app/(protected)/calendar/page");
    render(<CalendarPage />);

    await waitFor(() => expect(screen.getByTestId("calendar-view")).toBeInTheDocument());

    const event: CalendarEvent = {
      id: "evt1",
      title: "Summer BBQ",
      start: new Date("2026-07-04T17:00:00Z"),
      end: new Date("2026-07-04T20:00:00Z"),
      type: "EVENT",
      eventId: "evt1"
    };
    capturedOnEventClick!(event);

    expect(mockPush).toHaveBeenCalledWith("/events/evt1");
  });

  it("shows BirthdayPopover when a BIRTHDAY type event is clicked", async () => {
    setupQueries();
    const { default: CalendarPage } = await import("@/app/(protected)/calendar/page");
    render(<CalendarPage />);

    await waitFor(() => expect(screen.getByTestId("calendar-view")).toBeInTheDocument());

    const birthday: CalendarEvent = {
      id: "birthday-p1-2026",
      title: "Alice's Birthday",
      start: new Date("2026-07-15T00:00:00Z"),
      end: new Date("2026-07-16T00:00:00Z"),
      type: "BIRTHDAY"
    };
    capturedOnEventClick!(birthday);

    await waitFor(() =>
      expect(screen.getByTestId("birthday-popover")).toBeInTheDocument()
    );
    expect(screen.getByTestId("birthday-popover")).toHaveTextContent("Alice");
  });

  it("does not navigate when a BIRTHDAY event is clicked", async () => {
    setupQueries();
    const { default: CalendarPage } = await import("@/app/(protected)/calendar/page");
    render(<CalendarPage />);

    await waitFor(() => expect(screen.getByTestId("calendar-view")).toBeInTheDocument());

    const birthday: CalendarEvent = {
      id: "birthday-p1-2026",
      title: "Alice's Birthday",
      start: new Date("2026-07-15T00:00:00Z"),
      end: new Date("2026-07-16T00:00:00Z"),
      type: "BIRTHDAY"
    };
    capturedOnEventClick!(birthday);

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("wires onRangeChange to CalendarView and handles navigation without crashing", async () => {
    setupQueries();
    const { default: CalendarPage } = await import("@/app/(protected)/calendar/page");
    render(<CalendarPage />);

    await waitFor(() => expect(screen.getByTestId("calendar-view")).toBeInTheDocument());

    // onRangeChange must be wired (CalendarView mock captured it)
    expect(capturedOnRangeChange).not.toBeNull();

    // Calling it with a new range should not throw and component stays mounted
    await act(async () => {
      capturedOnRangeChange!(new Date("2026-08-01"), new Date("2026-08-31"));
    });

    expect(screen.getByTestId("calendar-view")).toBeInTheDocument();
  });
});
