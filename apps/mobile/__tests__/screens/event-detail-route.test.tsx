import React from "react";
import { render, screen } from "@testing-library/react-native";
import EventDetailRoute from "../../app/(tabs)/events/[eventId]";

jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ eventId: "f1" }) }));
jest.mock("@clerk/clerk-expo", () => ({
  useAuth: () => ({ getToken: jest.fn().mockResolvedValue("test-token") }),
}));
jest.mock("../../hooks/useEvents", () => ({
  ...jest.requireActual("../../hooks/useEvents"),
  useEvent: jest.fn(),
}));
jest.mock("../../components/events/OwnEventDetail", () => jest.fn(() => null));
jest.mock("../../components/events/ForeignEventDetail", () => jest.fn(() => null));
import { useEvent } from "../../hooks/useEvents";

describe("EventDetailRoute stale-cache suppression", () => {
  it("renders the unavailable state on error even when cached data exists", () => {
    (useEvent as jest.Mock).mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error("API 403: Not authorized to view this event"),
      data: { id: "f1", title: "Stale Cached BBQ", participants: [], tasks: [], myRsvp: null },
    });
    render(<EventDetailRoute />);
    expect(screen.getByText("This event is no longer available.")).toBeTruthy();
    expect(screen.queryByText("Stale Cached BBQ")).toBeNull();
  });
});
