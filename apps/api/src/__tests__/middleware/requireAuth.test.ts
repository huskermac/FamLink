import { getAuth } from "@clerk/express";
import request from "supertest";
import { createApp } from "../../server";
import { TEST_CLERK_ID } from "../helpers/auth";
import { seedTestPerson } from "../helpers/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
  getAuth: vi.fn()
}));

describe("requireAuth", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => {
    mockGetAuth.mockReset();
  });

  it("returns 401 when no Authorization header is present", async () => {
    mockGetAuth.mockReturnValue({ userId: null });
    const res = await request(app).get("/api/v1/persons/me");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("returns 401 when Clerk JWT is invalid or expired", async () => {
    mockGetAuth.mockReturnValue({ userId: null });
    const res = await request(app)
      .get("/api/v1/persons/me")
      .set("Authorization", "Bearer invalid");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("attaches userId to req and succeeds for valid auth", async () => {
    await seedTestPerson();
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .get("/api/v1/persons/me")
      .set("Authorization", "Bearer mock-token");
    expect(res.status).not.toBe(401);
    expect(res.body.userId).toBe(TEST_CLERK_ID);
  });
});
