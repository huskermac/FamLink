import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ForeignEventDetail } from "@/components/events/ForeignEventDetail";
import type { ForeignEventDTO } from "@/lib/api/events";

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock("@/components/events/RsvpButton", () => ({ RsvpButton: () => <div data-testid="rsvp" /> }));
vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() })
}));
vi.mock("@/lib/api/events", () => ({ addItem: vi.fn(), deleteItem: vi.fn() }));

const dto: ForeignEventDTO = {
  id: "e1", title: "Shared Picnic", description: "Bring food", startAt: "2026-07-04T17:00:00Z", endAt: null,
  locationName: "Park", locationAddress: null, locationMapUrl: null, eventType: "PARTY",
  participants: [{ displayName: "Alice", rsvpStatus: "YES" }, { displayName: "Bob", rsvpStatus: null }],
  tasks: [
    { id: "i1", name: "Mine", quantity: null, notes: null, status: "UNCLAIMED", isOwn: true },
    { id: "i2", name: "Theirs", quantity: null, notes: null, status: "UNCLAIMED", isOwn: false }
  ]
};

describe("ForeignEventDetail", () => {
  it("renders fields, attendees, RSVP, tasks, and a delete only on own tasks", () => {
    render(<ForeignEventDetail dto={dto} eventId="e1" />);
    expect(screen.getByText("Shared Picnic")).toBeInTheDocument();
    expect(screen.getByText("Park")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByTestId("rsvp")).toBeInTheDocument();
    expect(screen.getByText("Mine")).toBeInTheDocument();
    expect(screen.getByText("Theirs")).toBeInTheDocument();
    // delete control only on the own task
    expect(screen.getAllByRole("button", { name: /delete/i }).length).toBe(1);
  });
});
