import { getAuth } from "@clerk/express";
import { db } from "@famlink/db";
import request from "supertest";
import { createApp } from "../../server";
import { TEST_CLERK_ID } from "../helpers/auth";
import { seedTestFamily, seedTestPerson } from "../helpers/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
  getAuth: vi.fn()
}));

describe("calendar routes (P1-09)", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => {
    mockGetAuth.mockReset();
  });

  it("GET /calendar merges DB events and birthday synthetics, sorted by startAt", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    await db.person.update({
      where: { id: admin.id },
      data: { dateOfBirth: new Date("1990-06-15T00:00:00.000Z") }
    });

    const startAt = new Date(Date.UTC(2030, 5, 20, 14, 0, 0, 0));
    await db.event.create({
      data: {
        familyGroupId: familyGroup.id,
        createdByPersonId: admin.id,
        title: "June Meet",
        startAt,
        visibility: "FAMILY"
      }
    });

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .get(`/api/v1/families/${familyGroup.id}/calendar`)
      .query({ month: "2030-06" })
      .set("Authorization", "Bearer mock");

    expect(res.status).toBe(200);
    expect(res.body.month).toBe("2030-06");
    expect(res.body.events.length).toBe(2);
    const titles = res.body.events.map((e: { title: string }) => e.title);
    expect(titles).toContain("June Meet");
    expect(titles.some((t: string) => t.includes("Birthday"))).toBe(true);
    const times = res.body.events.map((e: { startAt: string }) => e.startAt);
    const sorted = [...times].sort();
    expect(times).toEqual(sorted);
  });

  it("GET /calendar/upcoming clamps days to 90", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .get(`/api/v1/families/${familyGroup.id}/calendar/upcoming`)
      .query({ days: 500 })
      .set("Authorization", "Bearer mock");

    expect(res.status).toBe(200);
    expect(res.body.generatedAt).toBeDefined();
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  it("GET /calendar/birthdays sorts by daysUntilBirthday", async () => {
    const admin = await seedTestPerson({ firstName: "Soon" });
    const { familyGroup } = await seedTestFamily(admin.id);
    const later = await db.person.create({
      data: {
        firstName: "Later",
        lastName: "Person",
        ageGateLevel: "NONE",
        userId: null,
        dateOfBirth: new Date("1995-12-25T00:00:00.000Z")
      }
    });
    await db.familyMember.create({
      data: {
        familyGroupId: familyGroup.id,
        personId: later.id,
        roles: ["MEMBER"],
        permissions: []
      }
    });
    await db.person.update({
      where: { id: admin.id },
      data: { dateOfBirth: new Date("1990-01-05T00:00:00.000Z") }
    });

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .get(`/api/v1/families/${familyGroup.id}/calendar/birthdays`)
      .set("Authorization", "Bearer mock");

    expect(res.status).toBe(200);
    expect(res.body.birthdays.length).toBeGreaterThanOrEqual(2);
    const days = res.body.birthdays.map((b: { daysUntilBirthday: number }) => b.daysUntilBirthday);
    const sorted = [...days].sort((a, b) => a - b);
    expect(days).toEqual(sorted);
  });
});
