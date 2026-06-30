import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForeignEventDetail } from "@/components/events/ForeignEventDetail";
import type { ForeignEventDTO } from "@/lib/api/events";

// useMutation is called twice per render, in fixed source order: `add` first,
// then `remove`. We capture each call's `mutate` so tests can assert on args.
const mockAddMutate = vi.fn();
const mockRemoveMutate = vi.fn();
const mockInvalidate = vi.fn();
let useMutationCallIndex = 0;

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock("@/components/events/RsvpButton", () => ({ RsvpButton: () => <div data-testid="rsvp" /> }));
vi.mock("@tanstack/react-query", () => ({
  useMutation: () => {
    // Each render calls useMutation exactly twice, in fixed order: add, then remove.
    // Use odd/even parity (not a monotonic counter) so this holds across re-renders.
    useMutationCallIndex += 1;
    const mutate = useMutationCallIndex % 2 === 1 ? mockAddMutate : mockRemoveMutate;
    return { mutate, isPending: false };
  },
  useQueryClient: () => ({ invalidateQueries: mockInvalidate })
}));
vi.mock("@/lib/api/events", () => ({ addItem: vi.fn(), deleteItem: vi.fn() }));

beforeEach(() => {
  mockAddMutate.mockClear();
  mockRemoveMutate.mockClear();
  mockInvalidate.mockClear();
  useMutationCallIndex = 0;
});

const dto: ForeignEventDTO = {
  id: "e1", title: "Shared Picnic", description: "Bring food", startAt: "2026-07-04T17:00:00Z", endAt: null,
  locationName: "Park", locationAddress: null, locationMapUrl: null, eventType: "PARTY",
  participants: [{ displayName: "Alice", rsvpStatus: "YES" }, { displayName: "Bob", rsvpStatus: null }],
  tasks: [
    { id: "i1", name: "Mine", quantity: null, notes: null, status: "UNCLAIMED", isOwn: true },
    { id: "i2", name: "Theirs", quantity: null, notes: null, status: "UNCLAIMED", isOwn: false }
  ]
};

const dtoNoTasks: ForeignEventDTO = {
  ...dto,
  tasks: [],
  participants: []
};

describe("ForeignEventDetail — rendering", () => {
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

  it("shows 'None yet' when participants list is empty", () => {
    render(<ForeignEventDetail dto={dtoNoTasks} eventId="e1" />);
    expect(screen.getByText("None yet")).toBeInTheDocument();
  });

  it("renders quantity next to item name when present", () => {
    const dtoWithQty: ForeignEventDTO = {
      ...dto,
      tasks: [{ id: "i3", name: "Cups", quantity: "20", notes: null, status: "UNCLAIMED", isOwn: true }]
    };
    render(<ForeignEventDetail dto={dtoWithQty} eventId="e1" />);
    expect(screen.getByText(/Cups · 20/)).toBeInTheDocument();
  });
});

describe("ForeignEventDetail — interactions", () => {
  it("clicking Add with input filled calls addItem mutate with trimmed name", async () => {
    render(<ForeignEventDetail dto={dto} eventId="e1" />);
    const input = screen.getByLabelText("add item");
    await userEvent.type(input, "  Balloons  ");
    fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));
    expect(mockAddMutate).toHaveBeenCalledWith("Balloons");
  });

  it("clicking Add with empty input does NOT call mutate", () => {
    render(<ForeignEventDetail dto={dto} eventId="e1" />);
    fireEvent.click(screen.getByRole("button", { name: /^Add$/i }));
    expect(mockAddMutate).not.toHaveBeenCalled();
  });

  it("clicking Delete on an own task calls remove mutate with item id", () => {
    render(<ForeignEventDetail dto={dto} eventId="e1" />);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(mockRemoveMutate).toHaveBeenCalledWith("i1");
  });
});
