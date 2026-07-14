import { db } from "@famlink/db";
import { normalizePhone } from "./contact";
import { rsvpClosed } from "./rsvpWindow";
import { isPhoneSuppressed, recordSmsOptIn, recordSmsOptOut } from "./smsConsent";

export type SmsKeyword = "STOP" | "START" | "HELP" | "YES" | "NO" | "UNKNOWN";

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_WORDS = new Set(["START", "UNSTOP"]);
const YES_WORDS = new Set(["Y", "YES"]);
const NO_WORDS = new Set(["N", "NO"]);

export function parseSmsKeyword(body: string): SmsKeyword {
  const t = body.trim().toUpperCase().replace(/^[^A-Z]+/, "").replace(/[^A-Z]+$/, "");
  if (STOP_WORDS.has(t)) return "STOP";
  if (START_WORDS.has(t)) return "START";
  if (YES_WORDS.has(t)) return "YES";
  if (NO_WORDS.has(t)) return "NO";
  if (t === "HELP") return "HELP";
  return "UNKNOWN";
}

const HELP_REPLY =
  "FamLink: family event invites. Reply Y to RSVP yes, N to decline, STOP to opt out.";
const GUIDANCE_REPLY =
  "Reply Y to RSVP yes, N to decline, HELP for help, STOP to opt out.";
const RESUBSCRIBED_REPLY = "You're re-subscribed to FamLink event texts.";
const ENDED_REPLY = "This event has ended — RSVP is no longer available.";

async function findPersonIds(phoneNormalized: string): Promise<string[]> {
  const persons = await db.person.findMany({ where: { phoneNormalized }, select: { id: true } });
  return persons.map((p) => p.id);
}

/**
 * Most recent invitation for the number REGARDLESS of status: a Twilio retry of
 * the same message must re-write the same row, never fall through to the
 * next-most-recent PENDING one; also lets a guest change their answer (N→Y),
 * matching the web token page which allows re-RSVP until the deadline.
 */
async function findLatestInvitation(personIds: string[]) {
  if (personIds.length === 0) return null;
  return db.eventInvitation.findFirst({
    // guestPhone is set on exactly the invitations that were deliverable by SMS
    // (guest invites); famlinkUser cross-family participation invites also set
    // linkedPersonId but never guestPhone, so this excludes them.
    where: { linkedPersonId: { in: personIds }, guestPhone: { not: null } },
    orderBy: [{ sentAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    include: { event: { select: { title: true, startAt: true, endAt: true } } }
  });
}

async function hasPendingInvitation(personIds: string[]): Promise<boolean> {
  if (personIds.length === 0) return false;
  const pending = await db.eventInvitation.findFirst({
    // Same species scoping as findLatestInvitation — only SMS-deliverable (guest) invitations.
    where: { linkedPersonId: { in: personIds }, status: "PENDING", guestPhone: { not: null } },
    select: { id: true }
  });
  return pending !== null;
}

async function verifyPhoneOwnership(phoneNormalized: string, personId: string, messageSid: string): Promise<void> {
  const conflict = await db.person.findFirst({
    where: { phoneNormalized, phoneVerifiedAt: { not: null }, id: { not: personId } },
    select: { id: true }
  });
  if (conflict) {
    console.info(JSON.stringify({ event: "phone_verification_conflict", phoneNormalized, personId, messageSid }));
    return;
  }
  await db.person.update({ where: { id: personId }, data: { phoneVerifiedAt: new Date() } });
}

/**
 * Processes one inbound SMS. Returns the reply text (rendered as TwiML by the
 * route) or null for no reply. Idempotent — Twilio retries on non-2xx.
 * Replies contain ONLY the event title (isolation invariant).
 */
export async function handleInboundSms(from: string, body: string, messageSid: string): Promise<string | null> {
  const phoneNormalized = normalizePhone(from);
  if (!phoneNormalized) {
    console.info(JSON.stringify({ event: "sms_inbound_unparseable_from", messageSid }));
    return null;
  }
  const keyword = parseSmsKeyword(body);
  const suppressed = await isPhoneSuppressed(phoneNormalized);

  if (keyword === "STOP") {
    await recordSmsOptOut(phoneNormalized, messageSid);
    const personIds = await findPersonIds(phoneNormalized);
    if (personIds.length > 0) {
      await db.eventInvitation.updateMany({
        // guestPhone-only scoping — see findLatestInvitation: STOP must only
        // decline invitations that were actually deliverable by SMS.
        where: { linkedPersonId: { in: personIds }, status: "PENDING", guestPhone: { not: null } },
        data: { status: "DECLINED" }
      });
    }
    return null; // Twilio's built-in opt-out handling auto-confirms; replying would double-text
  }

  if (keyword === "START") {
    await recordSmsOptIn(phoneNormalized, messageSid);
    return RESUBSCRIBED_REPLY;
  }

  if (keyword === "HELP") {
    return HELP_REPLY; // always — CTIA requires HELP to keep working after STOP
  }

  if (keyword === "YES" || keyword === "NO") {
    if (suppressed && keyword === "YES") {
      await recordSmsOptIn(phoneNormalized, messageSid); // mirrors Twilio: YES re-opts-in
    }
    const invitation = await findLatestInvitation(await findPersonIds(phoneNormalized));
    if (!invitation || !invitation.linkedPersonId) return null;
    const canReply = keyword === "YES" || !suppressed;

    if (rsvpClosed(invitation.event)) {
      return canReply ? ENDED_REPLY : null;
    }

    await db.eventInvitation.update({
      where: { id: invitation.id },
      data: { status: keyword === "YES" ? "ACCEPTED" : "DECLINED" }
    });
    await verifyPhoneOwnership(phoneNormalized, invitation.linkedPersonId, messageSid);
    console.info(JSON.stringify({ event: "sms_inbound_rsvp", status: keyword, invitationId: invitation.id, messageSid }));

    if (!canReply) return null;
    return keyword === "YES"
      ? `RSVP received — see you at ${invitation.event.title}!`
      : `Got it — declined ${invitation.event.title}.`;
  }

  // UNKNOWN
  if (suppressed) return null;
  return (await hasPendingInvitation(await findPersonIds(phoneNormalized))) ? GUIDANCE_REPLY : null;
}
