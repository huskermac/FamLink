import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ParticipantsSection } from "@/components/events/ParticipantsSection";

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: vi.fn() }) }));

const participants = [
  { personId: "p1", displayName: "Active One", role: "PARTICIPANT", status: "ACTIVE" },
  { personId: "p2", displayName: "Revoked Two", role: "EVENT_ADMIN", status: "REVOKED" },
  { personId: "p3", displayName: "Admin Three", role: "EVENT_ADMIN", status: "ACTIVE" }
];

let queryState: { data: { participants: typeof participants } | undefined; isLoading: boolean } = {
  data: { participants },
  isLoading: false
};

const mockRevokeMutate = vi.fn();
const mockSetRoleMutate = vi.fn();
const mockInvalidate = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => queryState,
  useMutation: () => {
    // Each render calls useMutation exactly twice, in fixed order: revoke, then setRole.
    // Use odd/even parity (not a monotonic counter) so this holds across re-renders.
    useMutationCallIndex += 1;
    const mutate = useMutationCallIndex % 2 === 1 ? mockRevokeMutate : mockSetRoleMutate;
    return { mutate, isPending: false };
  },
  useQueryClient: () => ({ invalidateQueries: mockInvalidate })
}));
vi.mock("@/lib/api/events", () => ({ listParticipants: vi.fn(), revokeParticipant: vi.fn(), setParticipantRole: vi.fn() }));

let useMutationCallIndex = 0;

beforeEach(() => {
  queryState = { data: { participants }, isLoading: false };
  mockRevokeMutate.mockClear();
  mockSetRoleMutate.mockClear();
  mockInvalidate.mockClear();
  useMutationCallIndex = 0;
});

describe("ParticipantsSection — rendering", () => {
  it("lists participants and shows Revoke only for admins on active grants", () => {
    render(<ParticipantsSection eventId="e1" canAdmin={true} />);
    expect(screen.getByText("Active One")).toBeInTheDocument();
    expect(screen.getByText("Revoked Two")).toBeInTheDocument();
    // 2 active participants -> 2 revoke buttons
    expect(screen.getAllByRole("button", { name: /revoke/i }).length).toBe(2);
  });

  it("hides admin controls when canAdmin is false", () => {
    render(<ParticipantsSection eventId="e1" canAdmin={false} />);
    expect(screen.queryByRole("button", { name: /revoke/i })).toBeNull();
  });

  it("renders nothing while loading", () => {
    queryState = { data: undefined, isLoading: true };
    const { container } = render(<ParticipantsSection eventId="e1" canAdmin={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when participants list is empty", () => {
    queryState = { data: { participants: [] }, isLoading: false };
    const { container } = render(<ParticipantsSection eventId="e1" canAdmin={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when data is undefined and not loading", () => {
    queryState = { data: undefined, isLoading: false };
    const { container } = render(<ParticipantsSection eventId="e1" canAdmin={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows 'Make admin' for a PARTICIPANT role and 'Make participant' for EVENT_ADMIN", () => {
    render(<ParticipantsSection eventId="e1" canAdmin={true} />);
    expect(screen.getByRole("button", { name: "Make admin" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make participant" })).toBeInTheDocument();
  });
});

describe("ParticipantsSection — interactions", () => {
  it("clicking Revoke calls the revoke mutation with the participant's personId", () => {
    render(<ParticipantsSection eventId="e1" canAdmin={true} />);
    const revokeButtons = screen.getAllByRole("button", { name: /revoke/i });
    fireEvent.click(revokeButtons[0]);
    expect(mockRevokeMutate).toHaveBeenCalledWith("p1");
  });

  it("clicking 'Make admin' calls setRole mutation toggling role to EVENT_ADMIN", () => {
    render(<ParticipantsSection eventId="e1" canAdmin={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Make admin" }));
    expect(mockSetRoleMutate).toHaveBeenCalledWith({ personId: "p1", role: "EVENT_ADMIN" });
  });

  it("clicking 'Make participant' calls setRole mutation toggling role to PARTICIPANT", () => {
    render(<ParticipantsSection eventId="e1" canAdmin={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Make participant" }));
    expect(mockSetRoleMutate).toHaveBeenCalledWith({ personId: "p3", role: "PARTICIPANT" });
  });
});
