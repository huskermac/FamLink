import { getAuth } from "@clerk/express";
import { db } from "@famlink/db";
import request from "supertest";
import { createApp } from "../../server";
import { generateConsentToken } from "../../lib/linkRequest";
import { seedTestFamily } from "../../__tests__/helpers/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: vi.fn()
}));

describe("public consent page (/api/v1/consent)", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => {
    mockGetAuth.mockReset();
    mockGetAuth.mockReturnValue({ userId: null }); // the consent page is unauthenticated
  });

  async function seedFamilyAndAdmin(familyName = "The Test Family") {
    const admin = await db.person.create({
      data: { firstName: "Admin", lastName: "One", ageGateLevel: "ADULT", userId: `admin_${Math.random().toString(36).slice(2)}` }
    });
    const { familyGroup } = await seedTestFamily(admin.id);
    if (familyName !== "Test Family") {
      await db.familyGroup.update({ where: { id: familyGroup.id }, data: { name: familyName } });
    }
    return { admin, familyGroup };
  }

  async function seedTokenRequest(opts: {
    familyGroupId: string;
    requestedByPersonId: string;
    target: { phone?: string | null; email?: string | null };
    deliveredChannel: "SMS" | "EMAIL";
    deliveredContact: string;
    expiresAt?: Date;
    status?: string;
  }) {
    const target = await db.person.create({
      data: {
        firstName: "Target",
        lastName: "Person",
        ageGateLevel: "ADULT",
        userId: null,
        phone: opts.target.phone ?? null,
        email: opts.target.email ?? null
      }
    });
    const linkRequest = await db.linkRequest.create({
      data: {
        kind: "FAMILY_MEMBERSHIP",
        direction: "PULL",
        familyGroupId: opts.familyGroupId,
        targetPersonId: target.id,
        requestedByPersonId: opts.requestedByPersonId,
        status: opts.status ?? "PENDING",
        token: generateConsentToken(),
        tokenChannel: opts.deliveredChannel,
        deliveredContact: opts.deliveredContact,
        attestedAdult: true,
        expiresAt: opts.expiresAt ?? new Date(Date.now() + 30 * 86_400_000)
      }
    });
    return { target, linkRequest };
  }

  describe("GET /:token", () => {
    it("returns names only (family + target), never the token", async () => {
      const { admin, familyGroup } = await seedFamilyAndAdmin("The Jones Family");
      const { linkRequest } = await seedTokenRequest({
        familyGroupId: familyGroup.id,
        requestedByPersonId: admin.id,
        target: { phone: "+15551234567" },
        deliveredChannel: "SMS",
        deliveredContact: "+15551234567"
      });

      const res = await request(app).get(`/api/v1/consent/${linkRequest.token}`);

      expect(res.status).toBe(200);
      expect(res.body.familyName).toBe("The Jones Family");
      expect(res.body.targetName).toBe("Target");
      expect(res.body.token).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(linkRequest.token);
    });

    it("returns 404 for an unknown token", async () => {
      const res = await request(app).get("/api/v1/consent/does-not-exist");
      expect(res.status).toBe(404);
    });

    it("returns 410 on an expired request and never echoes the token", async () => {
      const { admin, familyGroup } = await seedFamilyAndAdmin();
      const { linkRequest } = await seedTokenRequest({
        familyGroupId: familyGroup.id,
        requestedByPersonId: admin.id,
        target: { email: "target@example.com" },
        deliveredChannel: "EMAIL",
        deliveredContact: "target@example.com",
        expiresAt: new Date(Date.now() - 1000)
      });

      const res = await request(app).get(`/api/v1/consent/${linkRequest.token}`);

      expect(res.status).toBe(410);
      expect(JSON.stringify(res.body)).not.toContain(linkRequest.token);

      const row = await db.linkRequest.findUnique({ where: { id: linkRequest.id } });
      expect(row?.status).toBe("EXPIRED");
    });
  });

  describe("POST /:token/accept", () => {
    it("grants membership and sets phoneVerifiedAt when the token was SMS-delivered to the current phone", async () => {
      const { admin, familyGroup } = await seedFamilyAndAdmin();
      const { target, linkRequest } = await seedTokenRequest({
        familyGroupId: familyGroup.id,
        requestedByPersonId: admin.id,
        target: { phone: "+15551234567", email: "target@example.com" },
        deliveredChannel: "SMS",
        deliveredContact: "+15551234567"
      });

      const res = await request(app).post(`/api/v1/consent/${linkRequest.token}/accept`);

      expect(res.status).toBe(200);
      expect(res.body.granted).toBe(true);

      const member = await db.familyMember.findUnique({
        where: { familyGroupId_personId: { familyGroupId: familyGroup.id, personId: target.id } }
      });
      expect(member).not.toBeNull();

      const person = await db.person.findUnique({ where: { id: target.id } });
      expect(person?.phoneVerifiedAt).not.toBeNull();
      expect(person?.emailVerifiedAt).toBeNull();
    });

    it("grants membership but skips the verification stamp when the contact changed since delivery", async () => {
      const { admin, familyGroup } = await seedFamilyAndAdmin();
      const { target, linkRequest } = await seedTokenRequest({
        familyGroupId: familyGroup.id,
        requestedByPersonId: admin.id,
        target: { phone: "+15559999999" }, // current phone differs from what the token was delivered to
        deliveredChannel: "SMS",
        deliveredContact: "+15551234567"
      });

      const res = await request(app).post(`/api/v1/consent/${linkRequest.token}/accept`);

      expect(res.status).toBe(200);
      expect(res.body.granted).toBe(true);

      const member = await db.familyMember.findUnique({
        where: { familyGroupId_personId: { familyGroupId: familyGroup.id, personId: target.id } }
      });
      expect(member).not.toBeNull();

      const person = await db.person.findUnique({ where: { id: target.id } });
      expect(person?.phoneVerifiedAt).toBeNull();
    });

    it("returns 409 on a second accept (single-use)", async () => {
      const { admin, familyGroup } = await seedFamilyAndAdmin();
      const { linkRequest } = await seedTokenRequest({
        familyGroupId: familyGroup.id,
        requestedByPersonId: admin.id,
        target: { email: "target@example.com" },
        deliveredChannel: "EMAIL",
        deliveredContact: "target@example.com"
      });

      const first = await request(app).post(`/api/v1/consent/${linkRequest.token}/accept`);
      expect(first.status).toBe(200);
      expect(first.body.granted).toBe(true);

      const second = await request(app).post(`/api/v1/consent/${linkRequest.token}/accept`);
      expect(second.status).toBe(409);
      expect(second.body.granted).toBe(false);
    });

    it("returns 404 for an unknown token", async () => {
      const res = await request(app).post("/api/v1/consent/does-not-exist/accept");
      expect(res.status).toBe(404);
    });
  });

  describe("request logging masks the consent token", () => {
    it("never logs the raw token — in the request path or in a POST's Referer header", async () => {
      const { admin, familyGroup } = await seedFamilyAndAdmin();
      const { linkRequest } = await seedTokenRequest({
        familyGroupId: familyGroup.id,
        requestedByPersonId: admin.id,
        target: { email: "target@example.com" },
        deliveredChannel: "EMAIL",
        deliveredContact: "target@example.com"
      });
      const token = linkRequest.token!;

      const writes: string[] = [];
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk: any) => {
          writes.push(String(chunk));
          return true;
        });

      try {
        await request(app).get(`/api/v1/consent/${token}`);
        await request(app)
          .post(`/api/v1/consent/${token}/accept`)
          .set("Referer", `http://localhost:3000/consent/${token}`);
      } finally {
        stdoutSpy.mockRestore();
      }

      const logLines = writes.join("");
      expect(logLines).toContain("[redacted]");
      expect(logLines).not.toContain(token);
    });
  });
});
