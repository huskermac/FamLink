import * as ClerkExpress from "@clerk/express";
import request from "supertest";
import { createApp } from "../../server";
import { TEST_CLERK_ID, mockClerkAuth } from "../helpers/auth";

describe("requireAuth", () => {
  const app = createApp();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns 401 when no Authorization header is present", async () => {
    jest.spyOn(ClerkExpress, "getAuth").mockReturnValue({ userId: null } as never);
    const res = await request(app).get("/api/v1/persons/me");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("returns 401 when Clerk JWT is invalid or expired", async () => {
    jest.spyOn(ClerkExpress, "getAuth").mockReturnValue({ userId: null } as never);
    const res = await request(app)
      .get("/api/v1/persons/me")
      .set("Authorization", "Bearer invalid");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("attaches userId to req and succeeds for valid auth", async () => {
    mockClerkAuth(TEST_CLERK_ID);
    const res = await request(app)
      .get("/api/v1/persons/me")
      .set("Authorization", "Bearer mock-token");
    expect(res.status).not.toBe(401);
    expect(res.body.userId).toBe(TEST_CLERK_ID);
  });
});
