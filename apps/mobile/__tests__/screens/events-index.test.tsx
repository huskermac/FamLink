import React from "react";
import { render, screen } from "@testing-library/react-native";
import EventsIndex from "../../app/(tabs)/events/index";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("../../hooks/useFamily", () => ({ useMyFamilies: jest.fn() }));
jest.mock("../../hooks/useEvents", () => ({
  useEvents: jest.fn(),
  useParticipatingEvents: jest.fn(),
}));
import { useMyFamilies } from "../../hooks/useFamily";
import { useEvents, useParticipatingEvents } from "../../hooks/useEvents";

const fam = { data: { memberships: [{ familyGroup: { id: "fam1", name: "F" }, roles: [], joinedAt: "" }] }, isLoading: false };
const own = { id: "e1", title: "Family Dinner", startAt: "2026-07-08T18:00:00.000Z", endAt: null, locationName: null, isBirthdayEvent: false };
const foreign = { id: "f1", title: "Neighbor BBQ", startAt: "2026-07-09T18:00:00.000Z", endAt: null, locationName: null, eventType: "GATHERING" };

function setup(ownQ: object, foreignQ: object) {
  (useMyFamilies as jest.Mock).mockReturnValue(fam);
  (useEvents as jest.Mock).mockReturnValue(ownQ);
  (useParticipatingEvents as jest.Mock).mockReturnValue(foreignQ);
  return render(<EventsIndex />);
}

describe("EventsIndex discovery merge", () => {
  it("renders own and foreign events chronologically with a Guest badge on foreign rows", () => {
    setup(
      { data: { events: [own] }, isLoading: false, isError: false },
      { data: { events: [foreign] }, isLoading: false, isError: false }
    );
    expect(screen.getByText("Family Dinner")).toBeTruthy();
    expect(screen.getByText("Neighbor BBQ")).toBeTruthy();
    expect(screen.getAllByText("Guest")).toHaveLength(1);
  });

  it("still renders own events when the participating query fails", () => {
    setup(
      { data: { events: [own] }, isLoading: false, isError: false },
      { data: undefined, isLoading: false, isError: true }
    );
    expect(screen.getByText("Family Dinner")).toBeTruthy();
    expect(screen.queryByText("Guest")).toBeNull();
  });

  it("still renders foreign events when the family events query fails", () => {
    setup(
      { data: undefined, isLoading: false, isError: true },
      { data: { events: [foreign] }, isLoading: false, isError: false }
    );
    expect(screen.getByText("Neighbor BBQ")).toBeTruthy();
  });
});
