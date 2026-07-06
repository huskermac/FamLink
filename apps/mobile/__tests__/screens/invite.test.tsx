import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import InviteScreen from "../../app/(tabs)/events/invite/[eventId]";

const mockSend = jest.fn();
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ eventId: "e1" }), useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock("@clerk/clerk-expo", () => ({
  useAuth: () => ({ getToken: jest.fn().mockResolvedValue("test-token") }),
}));
jest.mock("../../hooks/useEvents", () => ({
  ...jest.requireActual("../../hooks/useEvents"),
  useEvent: jest.fn(() => ({ data: { event: { id: "e1", familyGroupId: "famA", createdByPersonId: "p0" }, invitations: 0, rsvps: {}, eventItems: [] }, isLoading: false })),
  useInviteeSuggestions: jest.fn(() => ({ data: { suggestions: [{ person: { id: "s1", displayName: "Dana Cross", avatarUrl: null }, via: { personId: "k1", personName: "Kid One", relationshipType: "PARENT", relationshipState: "CONFIRMED" }, sharedChildren: [] }] }, isLoading: false })),
  useSendInvitations: jest.fn(() => ({ mutate: mockSend, isPending: false })),
}));
jest.mock("../../hooks/useFamily", () => ({
  useMembers: jest.fn(() => ({ data: { members: [{ person: { id: "m1", firstName: "Mom", lastName: "Smith", preferredName: null }, roles: [] }] }, isLoading: false })),
  useIsFamilyAdmin: jest.fn(() => true),
}));

describe("InviteScreen", () => {
  beforeEach(() => mockSend.mockClear());

  it("renders member, suggestion, and external guest sections", () => {
    render(<InviteScreen />);
    expect(screen.getByText("Mom Smith")).toBeTruthy();
    expect(screen.getByText("Dana Cross")).toBeTruthy();
    expect(screen.getByPlaceholderText("Name")).toBeTruthy();
    expect(screen.getByPlaceholderText("Email address")).toBeTruthy();
  });

  it("sends a tagged invitees array: selected member + suggestion(+admin role) + external guest", () => {
    render(<InviteScreen />);
    fireEvent.press(screen.getByText("Mom Smith"));           // select member
    fireEvent.press(screen.getByText("Dana Cross"));          // select suggestion
    fireEvent.press(screen.getByText("Make event admin"));    // admin toggle (visible: admin + selected)
    fireEvent.changeText(screen.getByPlaceholderText("Name"), "Guest Gary");
    fireEvent.changeText(screen.getByPlaceholderText("Email address"), "gary@example.com");
    fireEvent.press(screen.getByText("Send invitations"));
    // mutate is called as mutate(invitees, { onSuccess }) — assert the array arg,
    // tolerate the options object as the 2nd arg.
    expect(mockSend).toHaveBeenCalledWith(
      [
        { kind: "person", personId: "m1" },
        { kind: "famlinkUser", personId: "s1", role: "EVENT_ADMIN" },
        { kind: "guest", guestName: "Guest Gary", guestEmail: "gary@example.com", guestPhone: undefined },
      ],
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it("shows the admin toggle only after a suggestion is selected", () => {
    render(<InviteScreen />);
    expect(screen.queryByText("Make event admin")).toBeNull(); // hidden before selection
    fireEvent.press(screen.getByText("Dana Cross"));
    expect(screen.getByText("Make event admin")).toBeTruthy(); // shown after selection (admin viewer)
  });

  it("hides the admin toggle for a non-admin viewer", () => {
    const { useIsFamilyAdmin } = require("../../hooks/useFamily");
    // mockReturnValue (not -Once): the hook is called on every render (initial +
    // post-selection re-render), so a one-shot override would only apply to the
    // first render and the toggle-visibility render would fall back to the default.
    (useIsFamilyAdmin as jest.Mock).mockReturnValue(false);
    render(<InviteScreen />);
    fireEvent.press(screen.getByText("Dana Cross"));
    expect(screen.queryByText("Make event admin")).toBeNull();
    (useIsFamilyAdmin as jest.Mock).mockReturnValue(true);
  });
});
