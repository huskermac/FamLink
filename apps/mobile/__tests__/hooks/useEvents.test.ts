import { renderHook, waitFor, act } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { ReactNode } from "react";
import { useEvents, useEvent, useRsvp, useClaimItem, useAddItem, useDeleteItem, useParticipatingEvents, isForeignEvent, useInviteeSuggestions, useSendInvitations, useParticipants, useRevokeParticipant, useSetParticipantRole } from "../../hooks/useEvents";
import type { EventDetailResponse } from "../../hooks/useEvents";

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

describe("items mutations", () => {
  it("useAddItem POSTs /items with name and quantity", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ id: "i9", name: "Napkins" });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useAddItem("e1"), { wrapper });
    await act(async () => { result.current.mutate({ name: "Napkins", quantity: "2 packs" }); });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/items",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Napkins", quantity: "2 packs" }) })
    );
  });

  it("useDeleteItem DELETEs /items/:itemId", async () => {
    const mockFetch = jest.fn().mockResolvedValue({});
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useDeleteItem("e1"), { wrapper });
    await act(async () => { result.current.mutate("i1"); });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/items/i1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("useClaimItem POSTs /items/:itemId/claim (regression: never the potluck PUT)", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ id: "i1", status: "CLAIMED" });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useClaimItem("e1"), { wrapper });
    await act(async () => { result.current.mutate("i1"); });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/items/i1/claim",
      expect.objectContaining({ method: "POST" })
    );
  });
});

describe("useParticipatingEvents", () => {
  it("fetches /api/v1/events/participating with the days window", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      events: [{ id: "f1", title: "Foreign BBQ", startAt: "2026-07-10T18:00:00.000Z", endAt: null, locationName: null, eventType: "GATHERING" }],
      generatedAt: ""
    });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useParticipatingEvents(30), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/events/participating?days=30");
    expect(result.current.data?.events[0].title).toBe("Foreign BBQ");
  });
});

describe("isForeignEvent", () => {
  const foreign: EventDetailResponse = {
    id: "e1", title: "T", description: null, startAt: "", endAt: null,
    locationName: null, locationAddress: null, locationMapUrl: null,
    eventType: "GATHERING", participants: [], tasks: [], myRsvp: null
  };
  const own: EventDetailResponse = {
    event: { ...mockEvent, familyGroupId: "fam1", createdByPersonId: "p0", description: null, locationAddress: null, locationMapUrl: null, visibility: "FAMILY", isRecurring: false, birthdayPersonId: null, createdAt: "", updatedAt: "" },
    invitations: 0, rsvps: { YES: 0, NO: 0, MAYBE: 0, PENDING: 0 }, eventItems: []
  };
  it("detects the flat foreign shape", () => { expect(isForeignEvent(foreign)).toBe(true); });
  it("detects the wrapped own shape", () => { expect(isForeignEvent(own)).toBe(false); });
});

describe("organizer hooks", () => {
  it("useInviteeSuggestions GETs the suggestions endpoint", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ suggestions: [] });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useInviteeSuggestions("e1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/events/e1/invitee-suggestions");
  });

  it("useSendInvitations POSTs the tagged invitees array", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ invitations: [] });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useSendInvitations("e1"), { wrapper });
    const invitees = [{ kind: "person", personId: "p1" }, { kind: "famlinkUser", personId: "p2", role: "EVENT_ADMIN" }];
    await act(async () => { result.current.mutate(invitees as never); });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/invitations",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ invitees }) })
    );
  });

  it("useParticipants GETs the participants endpoint", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ participants: [] });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useParticipants("e1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/events/e1/participants");
  });

  it("useRevokeParticipant POSTs the revoke endpoint", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ revoked: true });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useRevokeParticipant("e1"), { wrapper });
    await act(async () => { result.current.mutate("p9"); });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/participants/p9/revoke",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("useSetParticipantRole PUTs the role endpoint with the role body", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ updated: true });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useSetParticipantRole("e1"), { wrapper });
    await act(async () => { result.current.mutate({ personId: "p9", role: "EVENT_ADMIN" }); });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/participants/p9/role",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ role: "EVENT_ADMIN" }) })
    );
  });
});
