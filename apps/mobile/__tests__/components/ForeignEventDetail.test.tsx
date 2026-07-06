import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import ForeignEventDetail from "../../components/events/ForeignEventDetail";
import type { ForeignInvitedEventDTO } from "../../hooks/useEvents";

const mockRsvp = jest.fn();
const mockClaim = jest.fn();
const mockAdd = jest.fn();
const mockDelete = jest.fn();
jest.mock("@clerk/clerk-expo", () => ({
  useAuth: () => ({ getToken: jest.fn().mockResolvedValue("test-token") }),
}));
jest.mock("../../hooks/useEvents", () => ({
  ...jest.requireActual("../../hooks/useEvents"),
  useRsvp: jest.fn(() => ({ mutate: mockRsvp, isPending: false })),
  useAddItem: jest.fn(() => ({ mutate: mockAdd, isPending: false })),
  useDeleteItem: jest.fn(() => ({ mutate: mockDelete, isPending: false })),
  useClaimItem: jest.fn(() => ({ mutate: mockClaim, isPending: false })),
}));

const dto: ForeignInvitedEventDTO = {
  id: "f1", title: "Neighbor BBQ", description: "Bring a chair",
  startAt: "2026-07-09T18:00:00.000Z", endAt: null,
  locationName: "Park", locationAddress: null, locationMapUrl: null,
  eventType: "GATHERING",
  participants: [
    { displayName: "Dave", rsvpStatus: "YES" },
    { displayName: "Sara", rsvpStatus: null },
  ],
  tasks: [
    { id: "t1", name: "Ice", quantity: null, notes: null, status: "UNCLAIMED", isOwn: false },
    { id: "t2", name: "Buns", quantity: null, notes: null, status: "UNCLAIMED", isOwn: true },
  ],
  myRsvp: "YES",
};

describe("ForeignEventDetail", () => {
  beforeEach(() => { mockRsvp.mockClear(); mockClaim.mockClear(); mockAdd.mockClear(); mockDelete.mockClear(); });

  it("renders DTO fields, attendees, and NO owner affordances", () => {
    render(<ForeignEventDetail eventId="f1" dto={dto} />);
    expect(screen.getByText("Neighbor BBQ")).toBeTruthy();
    expect(screen.getByText("Dave")).toBeTruthy();
    expect(screen.getByText("Sara")).toBeTruthy();
    // no owner-only surfaces
    expect(screen.queryByText(/photo/i)).toBeNull();
    expect(screen.queryByText(/invite/i)).toBeNull();
    expect(screen.queryByText(/pending/i)).toBeNull();
  });

  it("marks the current RSVP from myRsvp", () => {
    render(<ForeignEventDetail eventId="f1" dto={dto} />);
    expect(screen.getByTestId("rsvp-YES-selected")).toBeTruthy();
  });

  it("RSVP buttons call the rsvp mutation", () => {
    render(<ForeignEventDetail eventId="f1" dto={dto} />);
    fireEvent.press(screen.getByText("? Maybe"));
    expect(mockRsvp).toHaveBeenCalledWith("MAYBE");
  });

  it("delete-own only on isOwn tasks; claim on unclaimed; add form works", () => {
    render(<ForeignEventDetail eventId="f1" dto={dto} />);
    expect(screen.getAllByText("Remove")).toHaveLength(1); // only t2 (isOwn)
    fireEvent.press(screen.getAllByText("Claim")[0]);
    expect(mockClaim).toHaveBeenCalledWith("t1");
    fireEvent.changeText(screen.getByPlaceholderText("Add something to bring…"), "Chips");
    fireEvent.press(screen.getByText("Add"));
    expect(mockAdd).toHaveBeenCalledWith({ name: "Chips" });
  });
});
