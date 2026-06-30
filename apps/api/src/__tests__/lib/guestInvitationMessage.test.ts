import { describe, it, expect } from "vitest";
import { buildGuestInvitationMessage } from "../../lib/notificationService";

describe("buildGuestInvitationMessage", () => {
  const startAt = new Date("2026-07-04T17:00:00Z");
  const rsvpUrl = "https://app.famlink.test/rsvp/tok_abc123";

  it("emits exactly title + time + link (subject and body)", () => {
    const { subject, body } = buildGuestInvitationMessage({ eventTitle: "Soccer Finals", startAt, rsvpUrl });
    const when = startAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    expect(subject).toBe("You're invited: Soccer Finals");
    expect(body).toBe(`You're invited to Soccer Finals on ${when}. RSVP here: ${rsvpUrl}`);
  });

  it("includes the title and the RSVP link", () => {
    const { body } = buildGuestInvitationMessage({ eventTitle: "Soccer Finals", startAt, rsvpUrl });
    expect(body).toContain("Soccer Finals");
    expect(body).toContain(rsvpUrl);
  });
});
