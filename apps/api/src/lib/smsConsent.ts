import { db } from "@famlink/db";
import { normalizePhone } from "./contact";

/** Number-scoped TCPA suppression check. Unparseable numbers are not suppressed. */
export async function isPhoneSuppressed(rawPhone: string): Promise<boolean> {
  const phoneNormalized = normalizePhone(rawPhone);
  if (!phoneNormalized) return false;
  const row = await db.smsConsent.findUnique({ where: { phoneNormalized } });
  return row?.optedOutAt != null;
}

/** PRECONDITION for both record fns: `phoneNormalized` must be E.164 (`normalizePhone` output) — raw numbers create orphan consent rows the gate can never match. */
export async function recordSmsOptOut(phoneNormalized: string, messageSid: string): Promise<void> {
  await db.smsConsent.upsert({
    where: { phoneNormalized },
    create: { phoneNormalized, optedOutAt: new Date() },
    update: { optedOutAt: new Date(), optedInAt: null }
  });
  console.info(JSON.stringify({ event: "sms_consent_change", direction: "opt_out", phoneNormalized, messageSid }));
}

export async function recordSmsOptIn(phoneNormalized: string, messageSid: string): Promise<void> {
  await db.smsConsent.upsert({
    where: { phoneNormalized },
    create: { phoneNormalized, optedInAt: new Date() },
    update: { optedOutAt: null, optedInAt: new Date() }
  });
  console.info(JSON.stringify({ event: "sms_consent_change", direction: "opt_in", phoneNormalized, messageSid }));
}
