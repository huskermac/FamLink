/**
 * socketServer.test.ts
 *
 * Unit tests for Socket.io emit helpers and auth middleware (ADR-09).
 * Only two events are defined: event:created and rsvp:updated.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Server } from "socket.io";

// ── Mock dependencies ─────────────────────────────────────────────────────────

vi.mock("@famlink/db", () => ({
  db: {
    person: { findUnique: vi.fn() },
    familyMember: { findMany: vi.fn() }
  }
}));

const mockVerifyToken = vi.fn();
vi.mock("@clerk/express", () => ({
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args)
}));

vi.mock("../env", () => ({
  env: {
    WEB_APP_URL: "http://localhost:3000",
    CLERK_SECRET_KEY: "test_clerk_key"
  }
}));

// Import after mocks
import {
  emitEventCreated,
  emitRsvpUpdated,
  socketAuthMiddleware,
  type EventCreatedPayload,
  type RsvpUpdatedPayload
} from "../socketServer";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockIo() {
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  return { io: { to } as unknown as Server, to, emit };
}

function makeSocket(token?: string) {
  return {
    handshake: { auth: token !== undefined ? { token } : {} },
    data: {} as Record<string, unknown>,
    disconnect: vi.fn()
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── emitEventCreated ──────────────────────────────────────────────────────────

describe("emitEventCreated", () => {
  it("emits to the correct family room", () => {
    const { io, to, emit } = makeMockIo();
    const payload: EventCreatedPayload = {
      id: "ev1",
      title: "Picnic",
      startTime: "2026-05-01T10:00:00Z",
      createdByName: "Alice Smith"
    };

    emitEventCreated(io, "fam1", payload);

    expect(to).toHaveBeenCalledWith("family:fam1");
    expect(emit).toHaveBeenCalledWith("event:created", payload);
  });

  it("emits the correct event payload shape", () => {
    const { io, emit } = makeMockIo();
    const payload: EventCreatedPayload = {
      id: "ev2",
      title: "BBQ",
      startTime: "2026-07-04T17:00:00Z",
      createdByName: "Bob Jones"
    };

    emitEventCreated(io, "fam2", payload);

    expect(emit).toHaveBeenCalledWith(
      "event:created",
      expect.objectContaining({
        id: "ev2",
        title: "BBQ",
        startTime: "2026-07-04T17:00:00Z",
        createdByName: "Bob Jones"
      })
    );
  });

  it("does NOT emit to individual user rooms", () => {
    const { io, to } = makeMockIo();
    emitEventCreated(io, "fam1", {
      id: "ev1",
      title: "X",
      startTime: "2026-01-01T00:00:00Z",
      createdByName: "Alice"
    });

    expect(to).not.toHaveBeenCalledWith(expect.stringContaining("user:"));
  });
});

// ── emitRsvpUpdated ───────────────────────────────────────────────────────────

describe("emitRsvpUpdated", () => {
  it("emits to the correct user room", () => {
    const { io, to, emit } = makeMockIo();
    const payload: RsvpUpdatedPayload = {
      eventId: "ev1",
      eventTitle: "Dinner",
      responderName: "Bob",
      status: "YES"
    };

    emitRsvpUpdated(io, "clerk_organizer_1", payload);

    expect(to).toHaveBeenCalledWith("user:clerk_organizer_1");
    expect(emit).toHaveBeenCalledWith("rsvp:updated", payload);
  });

  it("emits the correct RSVP payload shape", () => {
    const { io, emit } = makeMockIo();
    const payload: RsvpUpdatedPayload = {
      eventId: "ev2",
      eventTitle: "Party",
      responderName: "Alice",
      status: "NO"
    };

    emitRsvpUpdated(io, "clerk_organizer_2", payload);

    expect(emit).toHaveBeenCalledWith(
      "rsvp:updated",
      expect.objectContaining({
        eventId: "ev2",
        eventTitle: "Party",
        responderName: "Alice",
        status: "NO"
      })
    );
  });

  it("does NOT emit to family rooms", () => {
    const { io, to } = makeMockIo();
    emitRsvpUpdated(io, "clerk_org", {
      eventId: "ev1",
      eventTitle: "X",
      responderName: "Y",
      status: "YES"
    });

    expect(to).not.toHaveBeenCalledWith(expect.stringContaining("family:"));
  });
});

// ── socketAuthMiddleware ──────────────────────────────────────────────────────

describe("socketAuthMiddleware", () => {
  it("calls next with an error when no token is provided", async () => {
    const socket = makeSocket(); // no token
    const next = vi.fn();

    await socketAuthMiddleware(socket as never, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect((next.mock.calls[0][0] as Error).message).toContain("Missing");
  });

  it("attaches userId and calls next() on a valid token", async () => {
    mockVerifyToken.mockResolvedValue({ sub: "clerk_user_1" });
    const socket = makeSocket("valid_token");
    const next = vi.fn();

    await socketAuthMiddleware(socket as never, next);

    expect(next).toHaveBeenCalledWith(); // no error
    expect(socket.data.userId).toBe("clerk_user_1");
  });

  it("calls next with an error when verifyToken rejects", async () => {
    mockVerifyToken.mockRejectedValue(new Error("bad token"));
    const socket = makeSocket("invalid_token");
    const next = vi.fn();

    await socketAuthMiddleware(socket as never, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect((next.mock.calls[0][0] as Error).message).toContain("Invalid");
  });
});
