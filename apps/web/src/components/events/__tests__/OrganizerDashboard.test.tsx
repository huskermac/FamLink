import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrganizerDashboard } from "@/components/events/OrganizerDashboard";
import type { RsvpSummary } from "@/lib/api/events";
import type { RsvpUpdatedPayload } from "@/lib/socketTypes";

// Capture socket event handlers so tests can trigger them manually
const socketHandlers: Map<string, (data: unknown) => void> = new Map();

vi.mock("@/lib/socket", () => ({
  useSocketEvent: vi.fn((event: string, handler: (data: unknown) => void) => {
    socketHandlers.set(event, handler);
  })
}));

const initialSummary: RsvpSummary = { YES: 3, NO: 1, MAYBE: 2, PENDING: 4 };

beforeEach(() => {
  socketHandlers.clear();
});

describe("OrganizerDashboard", () => {
  it("renders initial RSVP counts", () => {
    render(<OrganizerDashboard eventId="evt1" initialRsvpSummary={initialSummary} />);
    expect(screen.getByText("3")).toBeInTheDocument(); // YES
    expect(screen.getByText("1")).toBeInTheDocument(); // NO
    expect(screen.getByText("2")).toBeInTheDocument(); // MAYBE
    expect(screen.getByText("4")).toBeInTheDocument(); // PENDING
  });

  it("increments YES count when rsvp:updated fires with YES", () => {
    render(<OrganizerDashboard eventId="evt1" initialRsvpSummary={initialSummary} />);

    const payload: RsvpUpdatedPayload = {
      eventId: "evt1",
      eventTitle: "Summer BBQ",
      responderName: "Alice",
      status: "YES"
    };

    act(() => {
      socketHandlers.get("rsvp:updated")?.(payload);
    });

    // YES should go from 3 to 4
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("ignores rsvp:updated events for other events", () => {
    render(<OrganizerDashboard eventId="evt1" initialRsvpSummary={initialSummary} />);

    const payload: RsvpUpdatedPayload = {
      eventId: "evt999",
      eventTitle: "Other Event",
      responderName: "Bob",
      status: "YES"
    };

    act(() => {
      socketHandlers.get("rsvp:updated")?.(payload);
    });

    // Counts unchanged — YES still 3, not 4
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
