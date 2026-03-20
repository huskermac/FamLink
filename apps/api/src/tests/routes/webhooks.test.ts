import { db } from "@famlink/db";
import request from "supertest";
import { Webhook } from "svix";
import { createApp } from "../../server";

const webhookSecret = process.env.CLERK_WEBHOOK_SECRET!;

function signPayload(payload: object): { body: string; headers: Record<string, string> } {
  const wh = new Webhook(webhookSecret);
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const ts = new Date();
  const body = JSON.stringify(payload);
  const svixSignature = wh.sign(msgId, ts, body);
  return {
    body,
    headers: {
      "svix-id": msgId,
      "svix-timestamp": Math.floor(ts.getTime() / 1000).toString(),
      "svix-signature": svixSignature,
      "content-type": "application/json"
    }
  };
}

describe("POST /api/v1/webhooks/clerk", () => {
  const app = createApp();

  it("returns 400 if Svix signature headers are missing", async () => {
    const res = await request(app)
      .post("/api/v1/webhooks/clerk")
      .set("content-type", "application/json")
      .send("{}");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid signature");
  });

  it("returns 400 if Svix signature is invalid (wrong secret)", async () => {
    const payload = { type: "user.created", data: { id: "user_bad" } };
    const wrong = new Webhook(
      "whsec_" + Buffer.from("wrong_secret_32_bytes_xxxxxxxx").toString("base64")
    );
    const msgId = "msg_wrong";
    const ts = new Date();
    const body = JSON.stringify(payload);
    const sig = wrong.sign(msgId, ts, body);

    const res = await request(app)
      .post("/api/v1/webhooks/clerk")
      .set("content-type", "application/json")
      .set("svix-id", msgId)
      .set("svix-timestamp", Math.floor(ts.getTime() / 1000).toString())
      .set("svix-signature", sig)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid signature");
  });

  it("user.created: creates Person with ageGateLevel NONE", async () => {
    const clerkId = `user_created_${Date.now()}`;
    const payload = {
      type: "user.created",
      data: {
        id: clerkId,
        first_name: "Jane",
        last_name: "Tester",
        image_url: "https://example.com/a.png",
        email_addresses: [{ email_address: "jane@example.com" }]
      }
    };
    const { body, headers } = signPayload(payload);

    const res = await request(app)
      .post("/api/v1/webhooks/clerk")
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const person = await db.person.findUnique({ where: { userId: clerkId } });
    expect(person).not.toBeNull();
    expect(person?.ageGateLevel).toBe("NONE");
    expect(person?.firstName).toBe("Jane");
  });

  it("user.created: is idempotent (two calls produce one record)", async () => {
    const clerkId = `user_idem_${Date.now()}`;
    const payload = {
      type: "user.created",
      data: {
        id: clerkId,
        first_name: "A",
        last_name: "B",
        email_addresses: []
      }
    };
    const signed = signPayload(payload);

    const res1 = await request(app)
      .post("/api/v1/webhooks/clerk")
      .set(signed.headers)
      .send(signed.body);
    const res2 = await request(app)
      .post("/api/v1/webhooks/clerk")
      .set(signed.headers)
      .send(signed.body);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const count = await db.person.count({ where: { userId: clerkId } });
    expect(count).toBe(1);
  });

  it("user.updated: updates firstName and lastName", async () => {
    const clerkId = `user_upd_${Date.now()}`;
    await db.person.create({
      data: {
        userId: clerkId,
        firstName: "Old",
        lastName: "Name",
        ageGateLevel: "NONE"
      }
    });

    const payload = {
      type: "user.updated",
      data: {
        id: clerkId,
        first_name: "Updated",
        last_name: "Person",
        email_addresses: []
      }
    };
    const { body, headers } = signPayload(payload);

    const res = await request(app)
      .post("/api/v1/webhooks/clerk")
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);

    const person = await db.person.findUnique({ where: { userId: clerkId } });
    expect(person?.firstName).toBe("Updated");
    expect(person?.lastName).toBe("Person");
  });

  it("unknown event type returns 200 without creating users", async () => {
    const before = await db.person.count();

    const payload = {
      type: "session.created",
      data: { id: "sess_1" }
    };
    const { body, headers } = signPayload(payload);

    const res = await request(app)
      .post("/api/v1/webhooks/clerk")
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const after = await db.person.count();
    expect(after).toBe(before);
  });
});
