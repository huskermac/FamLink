import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import OwnEventDetail from "../../components/events/OwnEventDetail";
import type { EventDetail } from "../../hooks/useEvents";

const mockMutate = jest.fn();
jest.mock("@clerk/clerk-expo", () => ({
  useAuth: () => ({ getToken: jest.fn().mockResolvedValue("test-token") }),
}));
jest.mock("../../hooks/useEvents", () => ({
  ...jest.requireActual("../../hooks/useEvents"),
  useRsvp: jest.fn(() => ({ mutate: mockMutate, isPending: false })),
  useAddItem: jest.fn(() => ({ mutate: mockMutate, isPending: false })),
  useDeleteItem: jest.fn(() => ({ mutate: mockMutate, isPending: false })),
  useClaimItem: jest.fn(() => ({ mutate: mockMutate, isPending: false })),
}));
jest.mock("../../hooks/useFamily", () => ({
  useMyPerson: jest.fn(() => ({ data: { id: "me1" } })),
}));
jest.mock("../../hooks/usePhotos", () => ({
  useEventPhotos: jest.fn(() => ({ data: [] })),
  useUploadEventPhoto: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
  useDeletePhoto: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
}));

const detail: EventDetail = {
  event: {
    id: "e1", familyGroupId: "fam1", createdByPersonId: "p0", title: "Family Dinner",
    description: null, startAt: "2026-07-08T18:00:00.000Z", endAt: null,
    locationName: null, locationAddress: null, locationMapUrl: null,
    visibility: "FAMILY", isRecurring: false, isBirthdayEvent: false,
    birthdayPersonId: null, createdAt: "", updatedAt: ""
  },
  invitations: 0,
  rsvps: { YES: 1, NO: 0, MAYBE: 0, PENDING: 0 },
  eventItems: [
    { id: "i1", eventId: "e1", createdByPersonId: "me1", assignedToPersonId: null, name: "Salad", quantity: null, notes: null, isChecklistItem: false, status: "UNCLAIMED", visibility: "ALL", createdAt: "", updatedAt: "" },
    { id: "i2", eventId: "e1", createdByPersonId: "p0", assignedToPersonId: null, name: "Drinks", quantity: null, notes: null, isChecklistItem: false, status: "UNCLAIMED", visibility: "ALL", createdAt: "", updatedAt: "" },
  ],
};

describe("OwnEventDetail items", () => {
  beforeEach(() => mockMutate.mockClear());

  it("claims an unclaimed item via the claim mutation with the item id", () => {
    render(<OwnEventDetail eventId="e1" detail={detail} />);
    fireEvent.press(screen.getAllByText("Claim")[0]);
    expect(mockMutate).toHaveBeenCalledWith("i1");
  });

  it("shows Remove only on my own items", () => {
    render(<OwnEventDetail eventId="e1" detail={detail} />);
    // i1 is mine (createdByPersonId me1), i2 is not
    expect(screen.getAllByText("Remove")).toHaveLength(1);
  });

  it("adds an item through the add form", () => {
    render(<OwnEventDetail eventId="e1" detail={detail} />);
    fireEvent.changeText(screen.getByPlaceholderText("Add something to bring…"), "Napkins");
    fireEvent.press(screen.getByText("Add"));
    expect(mockMutate).toHaveBeenCalledWith({ name: "Napkins" });
  });
});
