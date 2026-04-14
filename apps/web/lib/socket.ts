/**
 * Socket.io client singleton + React hook.
 *
 * Usage:
 *   1. Call initSocket(token) once after obtaining the Clerk session token.
 *   2. Use useSocketEvent(event, handler) in components to subscribe.
 */

"use client";

import { io, type Socket } from "socket.io-client";
import { useEffect, useRef } from "react";

import type { EventCreatedPayload, RsvpUpdatedPayload } from "./socketTypes";

export type { EventCreatedPayload, RsvpUpdatedPayload };

let _socket: Socket | null = null;

/**
 * Create (or return existing) Socket.io client.
 * Safe to call multiple times — returns the same instance.
 */
export function initSocket(token: string): Socket {
  if (_socket) return _socket;
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
  _socket = io(base, {
    auth: { token },
    transports: ["websocket", "polling"],
  });
  return _socket;
}

/** Direct access to the socket instance (null until initSocket is called). */
export function getSocket(): Socket | null {
  return _socket;
}

type SocketEventMap = {
  "event:created": EventCreatedPayload;
  "rsvp:updated": RsvpUpdatedPayload;
  [key: string]: unknown;
};

/**
 * Subscribe to a Socket.io event. Unsubscribes on unmount.
 * No-op if the socket has not been initialized yet.
 */
export function useSocketEvent<K extends keyof SocketEventMap>(
  event: K,
  handler: (data: SocketEventMap[K]) => void
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const socket = _socket;
    if (!socket) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listener = (data: any) => handlerRef.current(data);
    socket.on(event as string, listener);
    return () => {
      socket.off(event as string, listener);
    };
  }, [event]);
}
