import request from "supertest";
import twilio from "twilio";
import { db } from "@famlink/db";
import { createApp } from "../../server";
import { env } from "../../lib/env";

const WEBHOOK_URL = `${env.API_PUBLIC_URL.replace(/\/$/, "")}/api/v1/webhooks/twilio/sms`;

function sign(params: Record<string, string>): string {
  return twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN, WEBHOOK_URL, params);
}

describe("POST /api/v1/webhooks/twilio/sms", () => {
  const app = createApp();
  const base = { MessageSid: "SM123", From: "+14155550144", To: "+15555551234" };

  it("400 when the signature header is missing", async () => {
    const res = await request(app).post("/api/v1/webhooks/twilio/sms").type("form").send({ ...base, Body: "Y" });
    expect(res.status).toBe(400);
  });

  it("400 when the signature is invalid", async () => {
    const res = await request(app)
      .post("/api/v1/webhooks/twilio/sms")
      .set("X-Twilio-Signature", "obviously-wrong")
      .type("form")
      .send({ ...base, Body: "Y" });
    expect(res.status).toBe(400);
  });

  it("200 + TwiML message reply for HELP with a valid signature", async () => {
    const params = { ...base, Body: "HELP" };
    const res = await request(app)
      .post("/api/v1/webhooks/twilio/sms")
      .set("X-Twilio-Signature", sign(params))
      .type("form")
      .send(params);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("xml");
    expect(res.text).toContain("<Message>");
    expect(res.text).toContain("STOP");
  });

  it("200 + empty TwiML for STOP, and the number is suppressed", async () => {
    const params = { ...base, Body: "STOP" };
    const res = await request(app)
      .post("/api/v1/webhooks/twilio/sms")
      .set("X-Twilio-Signature", sign(params))
      .type("form")
      .send(params);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("<Message>");
    const row = await db.smsConsent.findUnique({ where: { phoneNormalized: "+14155550144" } });
    expect(row?.optedOutAt).not.toBeNull();
  });

  it("end-to-end: signed Y accepts the invitation through the mounted route", async () => {
    const creator = await db.person.create({ data: { firstName: "Org", lastName: "Anizer" } });
    const family = await db.familyGroup.create({ data: { name: "Fam", createdById: creator.id } });
    const event = await db.event.create({
      data: { familyGroupId: family.id, createdByPersonId: creator.id, title: "Route BBQ", startAt: new Date(Date.now() + 86_400_000) }
    });
    const guest = await db.person.create({
      data: { firstName: "Gus", lastName: "Guest", phone: base.From, phoneNormalized: base.From }
    });
    const invitation = await db.eventInvitation.create({
      data: { eventId: event.id, guestPhone: base.From, guestToken: "tok_route_y", linkedPersonId: guest.id, status: "PENDING", sentAt: new Date() }
    });

    const params = { ...base, Body: "Y" };
    const res = await request(app)
      .post("/api/v1/webhooks/twilio/sms")
      .set("X-Twilio-Signature", sign(params))
      .type("form")
      .send(params);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Route BBQ");
    expect((await db.eventInvitation.findUnique({ where: { id: invitation.id } }))?.status).toBe("ACCEPTED");
  });
});
