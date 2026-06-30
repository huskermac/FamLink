import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import InvitePage from "../page";

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: vi.fn().mockResolvedValue("t") }) }));
vi.mock("next/navigation", () => ({ useParams: () => ({ eventId: "e1" }), useRouter: () => ({ push: vi.fn() }) }));

const mockSend = vi.fn().mockResolvedValue({ invitations: [] });
vi.mock("@/lib/api/events", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/events")>("@/lib/api/events");
  return {
    ...actual,
    sendInvitations: (...a: unknown[]) => mockSend(...a),
    getEventInviteeSuggestions: vi.fn(),
    getEventDetails: vi.fn()
  };
});
vi.mock("@/lib/api/family", () => ({ getMyFamilies: vi.fn(), getFamilyDetails: vi.fn() }));

const queryData: Record<string, unknown> = {};
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({ data: queryData[String(queryKey[0])] })
}));

beforeEach(() => {
  mockSend.mockClear();
  queryData["event"] = { event: { id: "e1", familyGroupId: "fam1" } };       // member shape
  queryData["families"] = [{ familyGroup: { id: "fam1" }, role: "ADMIN", roles: ["ADMIN", "ORGANIZER"] }];
  queryData["family-detail"] = { members: [] };
  queryData["invitee-suggestions"] = { suggestions: [{ person: { id: "p2", displayName: "Cross Person", avatarUrl: null }, via: { personId: "p1", personName: "Me", relationshipType: "CO_PARENT", relationshipState: "ACTIVE" }, sharedChildren: [] }] };
});

describe("InvitePage cross-family invites", () => {
  it("sends a suggestion as kind:famlinkUser role EVENT_ADMIN when the admin toggle is on", async () => {
    render(<InvitePage />);
    await userEvent.click(screen.getByLabelText("Cross Person"));
    await userEvent.click(screen.getByLabelText(/make event admin/i));
    await userEvent.click(screen.getByRole("button", { name: /send invitations/i }));
    expect(mockSend).toHaveBeenCalledWith("e1", [{ kind: "famlinkUser", personId: "p2", role: "EVENT_ADMIN" }], expect.anything());
  });

  it("hides the admin toggle for a non-admin viewer of the event's family", () => {
    queryData["families"] = [{ familyGroup: { id: "fam1" }, role: "MEMBER", roles: ["MEMBER"] }];
    render(<InvitePage />);
    expect(screen.queryByLabelText(/make event admin/i)).toBeNull();
  });
});
