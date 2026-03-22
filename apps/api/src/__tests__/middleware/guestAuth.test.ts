import express from "express";
import request from "supertest";
import { generateGuestToken } from "../../lib/guestToken";
import {
  requireGuestToken,
  type GuestRequest
} from "../../middleware/guestAuth";

describe("requireGuestToken", () => {
  function makeApp() {
    const app = express();
    app.get("/t", requireGuestToken, (req, res) => {
      const g = (req as GuestRequest).guest;
      res.json({ personId: g.personId, scope: g.scope });
    });
    return app;
  }

  const app = makeApp();

  it("returns 401 when no token is provided", async () => {
    const res = await request(app).get("/t");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/required/i);
  });

  it("returns 401 for an invalid token", async () => {
    const res = await request(app).get("/t").query({ token: "not-a-jwt" });
    expect(res.status).toBe(401);
  });

  it("accepts Bearer token in Authorization header", async () => {
    const token = generateGuestToken(
      {
        personId: "pid",
        scope: "VIEW",
        resourceId: "eid",
        resourceType: "EVENT"
      },
      "1h"
    );
    const res = await request(app)
      .get("/t")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ personId: "pid", scope: "VIEW" });
  });

  it("accepts token in query string", async () => {
    const token = generateGuestToken(
      {
        personId: "pid2",
        scope: "RSVP",
        resourceId: "eid2",
        resourceType: "EVENT"
      },
      "1h"
    );
    const res = await request(app).get("/t").query({ token });
    expect(res.status).toBe(200);
    expect(res.body.personId).toBe("pid2");
  });
});
