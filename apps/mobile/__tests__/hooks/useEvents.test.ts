import { renderHook, waitFor, act } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { ReactNode } from "react";
import { useEvents, useEvent, useRsvp, useClaimItem } from "../../hooks/useEvents";

jest.mock("../../lib/api", () => ({ useApiFetch: jest.fn() }));
import { useApiFetch } from "../../lib/api";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false }, mutations: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

const mockEvent = { id: "e1", title: "Family Dinner", startAt: "2026-05-01T18:00:00.000Z", endAt: null, locationName: "Mom's House", isBirthdayEvent: false };

describe("useEvents", () => {
  it("fetches upcoming events for the family", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ events: [mockEvent], generatedAt: "" });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useEvents("fam1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/families/fam1/calendar/upcoming?days=30");
    expect(result.current.data?.events[0].title).toBe("Family Dinner");
  });

  it("is disabled when familyId is null", () => {
    const mockFetch = jest.fn();
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useEvents(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("useEvent", () => {
  it("fetches a single event by id", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      event: mockEvent,
      invitations: 5,
      rsvps: { YES: 3, NO: 1, MAYBE: 0, PENDING: 1 },
      eventItems: []
    });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useEvent("e1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/events/e1");
    expect(result.current.data?.event.title).toBe("Family Dinner");
  });
});

describe("useRsvp", () => {
  it("calls PUT /api/v1/events/:eventId/rsvp with status", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ rsvp: { status: "YES" } });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useRsvp("e1"), { wrapper });
    await act(async () => {
      result.current.mutate("YES");
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/rsvp",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ status: "YES" }) })
    );
  });
});
