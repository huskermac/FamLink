import request from "supertest";
import { createApp } from "../../server";

describe("GET /health", () => {
  it("returns 200 with { status: 'ok' }", async () => {
    const app = createApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
  });
});
