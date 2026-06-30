import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ParticipantsSection } from "@/components/events/ParticipantsSection";

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
const participants = [
  { personId: "p1", displayName: "Active One", role: "PARTICIPANT", status: "ACTIVE" },
  { personId: "p2", displayName: "Revoked Two", role: "EVENT_ADMIN", status: "REVOKED" }
];
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { participants }, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() })
}));
vi.mock("@/lib/api/events", () => ({ listParticipants: vi.fn(), revokeParticipant: vi.fn(), setParticipantRole: vi.fn() }));

describe("ParticipantsSection", () => {
  it("lists participants and shows Revoke only for admins on active grants", () => {
    render(<ParticipantsSection eventId="e1" canAdmin={true} />);
    expect(screen.getByText("Active One")).toBeInTheDocument();
    expect(screen.getByText("Revoked Two")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /revoke/i }).length).toBe(1);
  });

  it("hides admin controls when canAdmin is false", () => {
    render(<ParticipantsSection eventId="e1" canAdmin={false} />);
    expect(screen.queryByRole("button", { name: /revoke/i })).toBeNull();
  });
});
