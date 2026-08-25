import type { LinkRequest } from "@famlink/db";
import { db } from "@famlink/db";
import { env } from "./env";
import { isPhoneSuppressed } from "./smsConsent";
import { NotificationService, buildBudgetedSmsBody, GUEST_SMS_FOOTER, MAX_GUEST_INVITE_SMS } from "./notificationService";

/**
 * Names-only consent message: family name + the consent-page link ONLY. Never
 * accepts (and so never emits) a roster, other member names, or ids.
 */
export function buildConsentMessage(o: { familyName: string; consentUrl: string }): {
  subject: string;
  body: string;
  smsBody: string;
} {
  const prefix = "You've been invited to join ";
  const suffix = ` on FamLink. Review & respond: ${o.consentUrl}\n${GUEST_SMS_FOOTER}`;
  return {
    subject: `Join ${o.familyName} on FamLink`,
    body: `You've been invited to join ${o.familyName} on FamLink. Review & respond: ${o.consentUrl}. Linked families' admins can edit shared household details.`,
    smsBody: buildBudgetedSmsBody({ prefix, title: o.familyName, suffix, max: MAX_GUEST_INVITE_SMS })
  };
}

/**
 * Passive-target consent delivery (SMS/email) for a TOKEN-classified LinkRequest.
 * Single channel with fallback [R3]: prefer a non-suppressed phone, else email,
 * else no deliverable channel (no-op). Records `tokenChannel` + the exact
 * `deliveredContact` on the request so the accept path can verify only the
 * contact the token actually went to. Best-effort — callers must not let a
 * delivery failure fail the request that triggered it.
 */
export async function deliverConsentLink(args: { request: LinkRequest; personId: string }): Promise<void> {
  if (!args.request.token) return;
  const [person, family] = await Promise.all([
    db.person.findUnique({ where: { id: args.personId } }),
    db.familyGroup.findUnique({ where: { id: args.request.familyGroupId }, select: { name: true } })
  ]);
  if (!person || !family) return;
  const phone = person.phone ?? person.phoneNormalized;
  const email = person.email ?? person.emailNormalized;
  // Single channel with fallback [R3]: prefer a non-suppressed phone, else email.
  const phoneOk = phone ? !(await isPhoneSuppressed(phone)) : false;
  const channel: "SMS" | "EMAIL" | null = phoneOk ? "SMS" : email ? "EMAIL" : null;
  if (!channel) return;
  const deliveredContact = channel === "SMS" ? phone! : email!;
  await db.linkRequest.update({ where: { id: args.request.id }, data: { tokenChannel: channel, deliveredContact } });
  const consentUrl = `${env.WEB_APP_URL.replace(/\/$/, "")}/consent/${args.request.token}`;
  const m = buildConsentMessage({ familyName: family.name, consentUrl });
  const notifier = new NotificationService();
  await notifier.sendGuestInvitation({
    invitationId: args.request.id, // log carries the request id, NOT the token
    email: channel === "EMAIL" ? email : null,
    phone: channel === "SMS" ? phone : null,
    message: { subject: m.subject, body: m.body, smsBody: m.smsBody }
  });
}
