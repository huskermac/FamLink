import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { Alert } from "react-native";
import OwnEventDetail from "../../components/events/OwnEventDetail";
import type { EventDetail } from "../../hooks/useEvents";

// Revoke is behind a native confirm dialog. Auto-invoke the destructive button so
// pressing "Revoke" exercises the mutation (mirrors PR-1's Alert-backed delete tests).
jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
  const destructive = (buttons ?? []).find((b) => b.style === "destructive");
  destructive?.onPress?.();
});

const mockRevoke = jest.fn();
const mockSetRole = jest.fn();
jest.mock("@clerk/clerk-expo", () => ({ useAuth: () => ({ getToken: jest.fn() }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("../../hooks/useEvents", () => ({
  ...jest.requireActual("../../hooks/useEvents"),
  useRsvp: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
  useAddItem: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
  useDeleteItem: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
  useClaimItem: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
  useParticipants: jest.fn(() => ({ data: { participants: [
    { personId: "p1", displayName: "Active One", role: "PARTICIPANT", status: "ACTIVE" },
    { personId: "p2", displayName: "Revoked Two", role: "EVENT_ADMIN", status: "REVOKED" },
  ] } })),
  useRevokeParticipant: jest.fn(() => ({ mutate: mockRevoke, isPending: false })),
  useSetParticipantRole: jest.fn(() => ({ mutate: mockSetRole, isPending: false })),
}));
jest.mock("../../hooks/useFamily", () => ({
  useMyPerson: jest.fn(() => ({ data: { id: "me1" } })),
  useIsFamilyAdmin: jest.fn(() => true),
}));
jest.mock("../../hooks/usePhotos", () => ({
  useEventPhotos: jest.fn(() => ({ data: [] })),
  useUploadEventPhoto: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
  useDeletePhoto: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
}));

const detail: EventDetail = {
  event: { id: "e1", familyGroupId: "famA", createdByPersonId: "p0", title: "T", description: null, startAt: "2026-07-08T18:00:00.000Z", endAt: null, locationName: null, locationAddress: null, locationMapUrl: null, visibility: "FAMILY", isRecurring: false, isBirthdayEvent: false, birthdayPersonId: null, createdAt: "", updatedAt: "" },
  invitations: 0, rsvps: { YES: 0, NO: 0, MAYBE: 0, PENDING: 0 }, eventItems: [],
};

describe("OwnEventDetail participants", () => {
  beforeEach(() => { mockRevoke.mockClear(); mockSetRole.mockClear(); });

  it("lists active and revoked participants (revoked shown as history)", () => {
    render(<OwnEventDetail eventId="e1" detail={detail} />);
    expect(screen.getByText("Active One")).toBeTruthy();
    expect(screen.getByText("Revoked Two")).toBeTruthy();
  });

  it("admin can revoke an active participant (through the confirm dialog)", () => {
    render(<OwnEventDetail eventId="e1" detail={detail} />);
    fireEvent.press(screen.getByText("Revoke"));   // only the ACTIVE row has a Revoke action
    expect(mockRevoke).toHaveBeenCalledWith("p1");
  });

  it("admin can toggle an active participant's role", () => {
    render(<OwnEventDetail eventId="e1" detail={detail} />);
    fireEvent.press(screen.getByText("Make admin")); // p1 is PARTICIPANT → promote
    expect(mockSetRole).toHaveBeenCalledWith({ personId: "p1", role: "EVENT_ADMIN" });
  });

  it("hides revoke/role actions for a non-admin viewer", () => {
    const { useIsFamilyAdmin } = require("../../hooks/useFamily");
    (useIsFamilyAdmin as jest.Mock).mockReturnValue(false);
    render(<OwnEventDetail eventId="e1" detail={detail} />);
    expect(screen.getByText("Active One")).toBeTruthy();  // list still visible
    expect(screen.queryByText("Revoke")).toBeNull();      // actions gone
    (useIsFamilyAdmin as jest.Mock).mockReturnValue(true); // restore for other tests
  });
});
