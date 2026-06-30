import { describe, it, expect, vi, beforeEach } from "vitest";
import * as api from "@/lib/api";
import {
  previewParticipation,
  acceptParticipation,
  isForeignEventDTO,
  getEvents,
  getEventDetails,
  createEvent,
  updateEvent,
  updateRsvp,
  getRsvpStatus,
  sendInvitations,
  getEventInvitations,
  getEventInviteeSuggestions,
  declineParticipation,
  listParticipants,
  revokeParticipant,
  setParticipantRole,
  addItem,
  patchItem,
  deleteItem
} from "@/lib/api/events";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
const apiFetch = vi.mocked(api.apiFetch);
const getToken = vi.fn().mockResolvedValue("t");

beforeEach(() => apiFetch.mockReset());

describe("events client — participation", () => {
  it("previewParticipation calls the relative preview path with auth (getToken)", async () => {
    apiFetch.mockResolvedValue({ state: "PENDING", eventId: "e1" });
    await previewParticipation("tok123", getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/participation/preview?token=tok123",
      expect.objectContaining({ method: "GET", getToken })
    );
  });

  it("acceptParticipation posts the token to the event's accept route", async () => {
    apiFetch.mockResolvedValue({ accepted: true });
    await acceptParticipation("e1", "tok123", getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/participation/accept",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ token: "tok123" }), getToken })
    );
  });

  it("isForeignEventDTO distinguishes the flat foreign shape from the member shape", () => {
    expect(isForeignEventDTO({ id: "e", title: "t", participants: [], tasks: [] } as never)).toBe(true);
    expect(isForeignEventDTO({ event: { id: "e" } } as never)).toBe(false);
  });

  it("declineParticipation posts to the decline route", async () => {
    apiFetch.mockResolvedValue({ declined: true });
    await declineParticipation("e1", "tok456", getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/participation/decline",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ token: "tok456" }), getToken })
    );
  });

  it("listParticipants GETs the participants list", async () => {
    apiFetch.mockResolvedValue({ participants: [] });
    await listParticipants("e1", getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/participants",
      expect.objectContaining({ method: "GET", getToken })
    );
  });

  it("revokeParticipant POSTs to the revoke route", async () => {
    apiFetch.mockResolvedValue({ revoked: true });
    await revokeParticipant("e1", "p1", getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/participants/p1/revoke",
      expect.objectContaining({ method: "POST", getToken })
    );
  });

  it("setParticipantRole PUTs to the role route with body", async () => {
    apiFetch.mockResolvedValue({ updated: true });
    await setParticipantRole("e1", "p1", "EVENT_ADMIN", getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/participants/p1/role",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ role: "EVENT_ADMIN" }), getToken })
    );
  });
});

describe("events client — calendar + event CRUD", () => {
  it("getEvents GETs the upcoming calendar endpoint", async () => {
    apiFetch.mockResolvedValue({ events: [], generatedAt: "2026-07-01T00:00:00Z" });
    await getEvents("fam1", getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/families/fam1/calendar/upcoming",
      expect.objectContaining({ method: "GET", getToken })
    );
  });

  it("getEvents appends ?days= when options.days is provided", async () => {
    apiFetch.mockResolvedValue({ events: [], generatedAt: "2026-07-01T00:00:00Z" });
    await getEvents("fam1", getToken, { days: 30 });
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/families/fam1/calendar/upcoming?days=30",
      expect.objectContaining({ method: "GET", getToken })
    );
  });

  it("getEventDetails GETs the event by ID", async () => {
    apiFetch.mockResolvedValue({ event: { id: "e1" }, invitations: 0, rsvps: {}, eventItems: [] });
    await getEventDetails("e1", getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1",
      expect.objectContaining({ method: "GET", getToken })
    );
  });

  it("createEvent POSTs to the family events route", async () => {
    apiFetch.mockResolvedValue({ id: "e1", title: "Test" });
    const data = { title: "Test", startAt: "2026-07-04T17:00:00Z" };
    await createEvent("fam1", data, getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/families/fam1/events",
      expect.objectContaining({ method: "POST", body: JSON.stringify(data), getToken })
    );
  });

  it("updateEvent PUTs to the event route", async () => {
    apiFetch.mockResolvedValue({ id: "e1", title: "Updated" });
    const data = { title: "Updated" };
    await updateEvent("e1", data, getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify(data), getToken })
    );
  });
});

describe("events client — RSVPs", () => {
  it("updateRsvp PUTs to the rsvp route with status in body", async () => {
    apiFetch.mockResolvedValue({ id: "r1", status: "YES" });
    await updateRsvp("e1", "YES", getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/rsvp",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ status: "YES" }), getToken })
    );
  });

  it("getRsvpStatus GETs the rsvps list", async () => {
    apiFetch.mockResolvedValue({ rsvps: { YES: [], NO: [], MAYBE: [], PENDING: [] } });
    await getRsvpStatus("e1", getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/rsvps",
      expect.objectContaining({ method: "GET", getToken })
    );
  });
});

describe("events client — invitations", () => {
  it("sendInvitations POSTs invitees array to the invitations route", async () => {
    apiFetch.mockResolvedValue({ invitations: [] });
    const invitees = [{ kind: "person" as const, personId: "p1" }];
    await sendInvitations("e1", invitees, getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/invitations",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ invitees }), getToken })
    );
  });

  it("getEventInvitations GETs the invitations list", async () => {
    apiFetch.mockResolvedValue({ invitations: [] });
    await getEventInvitations("e1", getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/invitations",
      expect.objectContaining({ getToken })
    );
  });

  it("getEventInviteeSuggestions GETs the invitee-suggestions route", async () => {
    apiFetch.mockResolvedValue({ suggestions: [] });
    await getEventInviteeSuggestions("e1", getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/invitee-suggestions",
      expect.objectContaining({ getToken })
    );
  });
});

describe("events client — items", () => {
  it("addItem POSTs to the items route", async () => {
    apiFetch.mockResolvedValue({ id: "i1", name: "Chips" });
    const data = { name: "Chips", quantity: "2 bags" };
    await addItem("e1", data, getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/items",
      expect.objectContaining({ method: "POST", body: JSON.stringify(data), getToken })
    );
  });

  it("patchItem PATCHes the item route", async () => {
    apiFetch.mockResolvedValue({ id: "i1", name: "Chips", status: "CLAIMED" });
    const data = { status: "CLAIMED" };
    await patchItem("e1", "i1", data, getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/items/i1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify(data), getToken })
    );
  });

  it("deleteItem DELETEs the item route", async () => {
    apiFetch.mockResolvedValue(undefined);
    await deleteItem("e1", "i1", getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/items/i1",
      expect.objectContaining({ method: "DELETE", getToken })
    );
  });
});
