/** Shared Socket.io payload types (mirror of API's socketServer.ts). */

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
