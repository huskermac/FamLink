/**
 * Socket.io server — Phase 2 scope (ADR-09)
 *
 * Two events only:
 *   event:created  → emitted to family room when a new event is created
 *   rsvp:updated   → emitted to the organizer's user room when an RSVP is submitted
 *
 * No other real-time capability (typing, presence, chat) until Phase 3.
 */

import { Server } from "socket.io";
import type { Socket } from "socket.io";
import type { Server as HttpServer } from "http";
import { verifyToken } from "@clerk/express";
import { db } from "@famlink/db";
import { env } from "./env";

// ── Singleton io instance (set once in initializeSocketServer) ───────────────

let _io: Server | null = null;

export function getIo(): Server {
  if (!_io) throw new Error("Socket.io server not initialized");
  return _io;
}

// ── Payload types ─────────────────────────────────────────────────────────────

export interface EventCreatedPayload {
  id: string;
  title: string;
  startTime: string;
  createdByName: string;
}

export interface RsvpUpdatedPayload {
  eventId: string;
  eventTitle: string;
  responderName: string;
  status: string;
}

// ── Emit helpers ──────────────────────────────────────────────────────────────

export function emitEventCreated(
  io: Server,
  familyGroupId: string,
  event: EventCreatedPayload
): void {
  io.to(`family:${familyGroupId}`).emit("event:created", event);
}

export function emitRsvpUpdated(
  io: Server,
  organizerUserId: string,
  payload: RsvpUpdatedPayload
): void {
  io.to(`user:${organizerUserId}`).emit("rsvp:updated", payload);
}

// ── Auth middleware (exported for testing) ────────────────────────────────────

export async function socketAuthMiddleware(
  socket: Socket,
  next: (err?: Error) => void
): Promise<void> {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    next(new Error("Missing auth token"));
    return;
  }
  try {
    const payload = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
    socket.data.userId = payload.sub;
    next();
  } catch {
    next(new Error("Invalid auth token"));
  }
}

// ── Server initializer ────────────────────────────────────────────────────────

export function initializeSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: env.WEB_APP_URL,
      methods: ["GET", "POST"]
    },
    transports: ["websocket", "polling"]
  });

  io.use(socketAuthMiddleware);

  // ── Connection handler ────────────────────────────────────────────────────

  io.on("connection", async (socket) => {
    const clerkUserId: string = socket.data.userId;

    // Join personal room
    socket.join(`user:${clerkUserId}`);

    // Join a room for each family group the user belongs to
    try {
      const person = await db.person.findUnique({
        where: { userId: clerkUserId },
        select: { id: true }
      });

      if (person) {
        const memberships = await db.familyMember.findMany({
          where: { personId: person.id },
          select: { familyGroupId: true }
        });
        for (const { familyGroupId } of memberships) {
          socket.join(`family:${familyGroupId}`);
        }
      }
    } catch {
      // DB error during room join is non-fatal — socket stays connected to user room
    }
  });

  _io = io;
  return io;
}
