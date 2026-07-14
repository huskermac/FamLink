/** RSVP cutoff shared by the web link path (guest.ts) and SMS Y/N — keep in sync by construction. */
export function rsvpClosed(event: { startAt: Date; endAt: Date | null }): boolean {
  const deadline = event.endAt ?? event.startAt;
  return new Date() > deadline;
}
