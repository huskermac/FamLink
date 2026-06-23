import express from "express";
import request from "supertest";
import { describe, it, expect } from "vitest";
import { createRateLimiter } from "../../middleware/rateLimit";

describe("createRateLimiter", () => {
  it("allows requests up to the limit, then returns 429", async () => {
    const app = express();
    app.use(createRateLimiter({ windowMs: 60_000, limit: 2 }));
    app.get("/ping", (_req, res) => {
      res.json({ ok: true });
    });

    expect((await request(app).get("/ping")).status).toBe(200);
    expect((await request(app).get("/ping")).status).toBe(200);

    const blocked = await request(app).get("/ping");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many requests/i);
  });
});
