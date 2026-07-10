import { db } from "@famlink/db";
import { isPhoneSuppressed, recordSmsOptOut, recordSmsOptIn } from "../../lib/smsConsent";

describe("smsConsent", () => {
  // NOTE: brief used "+15550001111" (area code 555), which libphonenumber-js
  // flags invalid (555 is not an allocated NANP area code) — normalizePhone
  // would return null and silently short-circuit isPhoneSuppressed, making
  // every assertion below pass for the wrong reason. Using a real area code
  // with a 555 exchange (the codebase's existing fake-number convention, see
  // contact.test.ts) so these tests exercise actual suppression behavior.
  const phone = "+14155550111";

  it("isPhoneSuppressed is false for a number with no row", async () => {
    expect(await isPhoneSuppressed(phone)).toBe(false);
  });

  it("isPhoneSuppressed is false for an unparseable phone", async () => {
    expect(await isPhoneSuppressed("not-a-phone")).toBe(false);
  });

  it("recordSmsOptOut suppresses; normalization variants of the same number are suppressed", async () => {
    await recordSmsOptOut(phone, "SM1");
    expect(await isPhoneSuppressed(phone)).toBe(true);
    // raw formatting variant normalizes to the same E.164
    expect(await isPhoneSuppressed("(415) 555-0111")).toBe(true);
  });

  it("recordSmsOptIn clears suppression and stamps optedInAt", async () => {
    await recordSmsOptOut(phone, "SM1");
    await recordSmsOptIn(phone, "SM2");
    expect(await isPhoneSuppressed(phone)).toBe(false);
    const row = await db.smsConsent.findUnique({ where: { phoneNormalized: phone } });
    expect(row?.optedOutAt).toBeNull();
    expect(row?.optedInAt).not.toBeNull();
  });

  it("recordSmsOptOut clears optedInAt (row is never both states)", async () => {
    await recordSmsOptIn(phone, "SM1");
    await recordSmsOptOut(phone, "SM2");
    const row = await db.smsConsent.findUnique({ where: { phoneNormalized: phone } });
    expect(row?.optedOutAt).not.toBeNull();
    expect(row?.optedInAt).toBeNull();
  });

  it("opt-out is idempotent (safe Twilio retry)", async () => {
    await recordSmsOptOut(phone, "SM1");
    await recordSmsOptOut(phone, "SM1");
    expect(await isPhoneSuppressed(phone)).toBe(true);
  });
});
