import * as ClerkExpress from "@clerk/express";
import type { Express } from "express";
import request from "supertest";

export const TEST_CLERK_ID = "user_test_clerk_id_001";
export const TEST_USER_2_CLERK_ID = "user_test_clerk_id_002";

export function mockClerkAuth(userId: string | null): jest.SpyInstance {
  return jest
    .spyOn(ClerkExpress, "getAuth")
    .mockReturnValue({ userId } as ReturnType<typeof ClerkExpress.getAuth>);
}

export function authedRequest(app: Express, clerkId: string = TEST_CLERK_ID) {
  return request(app).set(
    "Authorization",
    `Bearer mock-token-for-${clerkId}`
  );
}
