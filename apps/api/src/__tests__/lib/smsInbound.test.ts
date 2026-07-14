import { db } from "@famlink/db";
import { parseSmsKeyword, handleInboundSms } from "../../lib/smsInbound";
import { isPhoneSuppressed, recordSmsOptOut } from "../../lib/smsConsent";

describe("parseSmsKeyword", () => {
  it.each([
    ["STOP", "STOP"], ["stop", "STOP"], [" Stop. ", "STOP"], ["UNSUBSCRIBE", "STOP"],
    ["QUIT", "STOP"], ["CANCEL", "STOP"], ["END", "STOP"], ["STOPALL", "STOP"],
    ["START", "START"], ["unstop", "START"],
    ["HELP", "HELP"], ["help!", "HELP"],
    ["Y", "YES"], ["yes", "YES"], ["Y!", "YES"],
    ["N", "NO"], ["No.", "NO"],
    ["maybe", "UNKNOWN"], ["YES PLEASE", "UNKNOWN"], ["", "UNKNOWN"], ["123", "UNKNOWN"]
  ])("%s -> %s", (input, expected) => {
    expect(parseSmsKeyword(input)).toBe(expected);
  });
});

const PHONE = "+14155550133";

async function makeFixture(opts: { sentAt?: Date; startAt?: Date; status?: string } = {}) {
  const creator = await db.person.create({ data: { firstName: "Org", lastName: "Anizer" } });
  const family = await db.familyGroup.create({ data: { name: "Fam", createdById: creator.id } });
  const event = await db.event.create({
    data: {
      familyGroupId: family.id,
      createdByPersonId: creator.id,
      title: "Summer BBQ",
      startAt: opts.startAt ?? new Date(Date.now() + 7 * 86_400_000)
    }
  });
  const guest = await db.person.create({
    data: { firstName: "Gus", lastName: "Guest", phone: PHONE, phoneNormalized: PHONE }
  });
  const invitation = await db.eventInvitation.create({
    data: {
      eventId: event.id,
      guestPhone: PHONE,
      guestToken: `tok_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      linkedPersonId: guest.id,
      status: opts.status ?? "PENDING",
      sentAt: opts.sentAt ?? new Date()
    }
  });
  return { creator, family, event, guest, invitation };
}

describe("handleInboundSms", () => {
  it("YES accepts the invitation, verifies the phone, and replies with the event title", async () => {
    const f = await makeFixture();
    const reply = await handleInboundSms(PHONE, "Y", "SM_yes");
    expect(reply).toContain("Summer BBQ");
    const inv = await db.eventInvitation.findUnique({ where: { id: f.invitation.id } });
    expect(inv?.status).toBe("ACCEPTED");
    const guest = await db.person.findUnique({ where: { id: f.guest.id } });
    expect(guest?.phoneVerifiedAt).not.toBeNull();
  });

  it("NO declines and verifies", async () => {
    const f = await makeFixture();
    await handleInboundSms(PHONE, "no", "SM_no");
    const inv = await db.eventInvitation.findUnique({ where: { id: f.invitation.id } });
    expect(inv?.status).toBe("DECLINED");
  });

  it("YES picks the most recently sent invitation when several exist", async () => {
    const older = await makeFixture({ sentAt: new Date(Date.now() - 86_400_000) });
    const newer = await makeFixture({ sentAt: new Date() });
    await handleInboundSms(PHONE, "Y", "SM_multi");
    expect((await db.eventInvitation.findUnique({ where: { id: newer.invitation.id } }))?.status).toBe("ACCEPTED");
    expect((await db.eventInvitation.findUnique({ where: { id: older.invitation.id } }))?.status).toBe("PENDING");
  });

  it("YES after the event ended does not write and replies 'ended'", async () => {
    const f = await makeFixture({ startAt: new Date(Date.now() - 86_400_000) });
    const reply = await handleInboundSms(PHONE, "Y", "SM_late");
    expect(reply).toContain("ended");
    expect((await db.eventInvitation.findUnique({ where: { id: f.invitation.id } }))?.status).toBe("PENDING");
  });

  it("YES with no invitation at all is silent", async () => {
    expect(await handleInboundSms(PHONE, "Y", "SM_none")).toBeNull();
  });

  it("replayed YES (Twilio retry) re-writes the SAME invitation — never falls through to the next one", async () => {
    const older = await makeFixture({ sentAt: new Date(Date.now() - 86_400_000) });
    const newer = await makeFixture({ sentAt: new Date() });
    await handleInboundSms(PHONE, "Y", "SM_replay");
    await handleInboundSms(PHONE, "Y", "SM_replay"); // retry of the same message
    expect((await db.eventInvitation.findUnique({ where: { id: newer.invitation.id } }))?.status).toBe("ACCEPTED");
    expect((await db.eventInvitation.findUnique({ where: { id: older.invitation.id } }))?.status).toBe("PENDING");
  });

  it("guest can change their answer: N then Y updates the same invitation to ACCEPTED", async () => {
    const f = await makeFixture();
    await handleInboundSms(PHONE, "N", "SM_first");
    await handleInboundSms(PHONE, "Y", "SM_second");
    expect((await db.eventInvitation.findUnique({ where: { id: f.invitation.id } }))?.status).toBe("ACCEPTED");
  });

  it("STOP suppresses, declines all PENDING invitations for the number, and returns null", async () => {
    const f1 = await makeFixture();
    const f2 = await makeFixture();
    const reply = await handleInboundSms(PHONE, "STOP", "SM_stop");
    expect(reply).toBeNull();
    expect(await isPhoneSuppressed(PHONE)).toBe(true);
    for (const f of [f1, f2]) {
      expect((await db.eventInvitation.findUnique({ where: { id: f.invitation.id } }))?.status).toBe("DECLINED");
    }
  });

  it("STOP from an unknown number is still recorded", async () => {
    await handleInboundSms("+14155550199", "STOP", "SM_stranger");
    expect(await isPhoneSuppressed("+14155550199")).toBe(true);
  });

  it("START clears suppression and confirms", async () => {
    await recordSmsOptOut(PHONE, "SM_pre");
    const reply = await handleInboundSms(PHONE, "START", "SM_start");
    expect(await isPhoneSuppressed(PHONE)).toBe(false);
    expect(reply).not.toBeNull();
  });

  it("YES while suppressed re-opts-in and processes the RSVP", async () => {
    const f = await makeFixture();
    await recordSmsOptOut(PHONE, "SM_pre");
    const reply = await handleInboundSms(PHONE, "YES", "SM_yes2");
    expect(await isPhoneSuppressed(PHONE)).toBe(false);
    expect(reply).toContain("Summer BBQ");
    expect((await db.eventInvitation.findUnique({ where: { id: f.invitation.id } }))?.status).toBe("ACCEPTED");
  });

  it("verification conflict: does not verify when a different person already holds a verified claim", async () => {
    const f = await makeFixture();
    await db.person.create({
      data: { firstName: "Rival", lastName: "Claim", phoneNormalized: PHONE, phoneVerifiedAt: new Date() }
    });
    await handleInboundSms(PHONE, "Y", "SM_conflict");
    const guest = await db.person.findUnique({ where: { id: f.guest.id } });
    expect(guest?.phoneVerifiedAt).toBeNull();
    // RSVP still recorded
    expect((await db.eventInvitation.findUnique({ where: { id: f.invitation.id } }))?.status).toBe("ACCEPTED");
  });

  it("HELP replies with guidance", async () => {
    const reply = await handleInboundSms(PHONE, "HELP", "SM_help");
    expect(reply).toContain("STOP");
  });

  it("HELP still replies while suppressed (CTIA)", async () => {
    await recordSmsOptOut(PHONE, "SM_pre");
    const reply = await handleInboundSms(PHONE, "HELP", "SM_help2");
    expect(reply).toContain("STOP");
  });

  it("unknown text replies with guidance only when a PENDING invitation exists", async () => {
    expect(await handleInboundSms(PHONE, "what?", "SM_u1")).toBeNull();
    await makeFixture();
    const reply = await handleInboundSms(PHONE, "what?", "SM_u2");
    expect(reply).toContain("Reply Y");
  });

  it("unparseable From is silent", async () => {
    expect(await handleInboundSms("garbage", "Y", "SM_bad")).toBeNull();
  });
});
