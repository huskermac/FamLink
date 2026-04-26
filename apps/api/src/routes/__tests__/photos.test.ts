import request from "supertest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../../server";

const mockGetAuth = vi.fn();

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: (req: unknown) => mockGetAuth(req)
}));

const mockPersonFindUnique = vi.fn();
const mockEventFindUnique = vi.fn();
const mockFamilyMemberFindUnique = vi.fn();
const mockEventPhotoCreate = vi.fn();
const mockEventPhotoFindMany = vi.fn();
const mockEventPhotoFindUnique = vi.fn();
const mockEventPhotoDelete = vi.fn();

vi.mock("@famlink/db", () => ({
  db: {
    person: { findUnique: (...a: unknown[]) => mockPersonFindUnique(...a) },
    event: { findUnique: (...a: unknown[]) => mockEventFindUnique(...a) },
    familyMember: { findUnique: (...a: unknown[]) => mockFamilyMemberFindUnique(...a) },
    eventPhoto: {
      create: (...a: unknown[]) => mockEventPhotoCreate(...a),
      findMany: (...a: unknown[]) => mockEventPhotoFindMany(...a),
      findUnique: (...a: unknown[]) => mockEventPhotoFindUnique(...a),
      delete: (...a: unknown[]) => mockEventPhotoDelete(...a)
    }
  }
}));

const mockCreatePresignedUpload = vi.fn();
const mockDeleteR2Object = vi.fn();

vi.mock("../../lib/r2", () => ({
  createPresignedUpload: (...a: unknown[]) => mockCreatePresignedUpload(...a),
  deleteR2Object: (...a: unknown[]) => mockDeleteR2Object(...a)
}));

const PERSON = { id: "p1", userId: "clerk_u1", firstName: "Alice", lastName: "Smith" };
const FAMILY_MEMBER = { id: "fm1", familyGroupId: "fam1", personId: "p1", roles: ["MEMBER"], permissions: [] };
const EVENT = { id: "ev1", familyGroupId: "fam1", createdByPersonId: "p1", title: "BBQ" };

function authAs(clerkUserId: string) {
  mockGetAuth.mockReturnValue({ userId: clerkUserId });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteR2Object.mockResolvedValue(undefined);
});

describe("POST /api/v1/photos/presign", () => {
  it("returns 401 when not authenticated", async () => {
    const app = createApp();
    mockGetAuth.mockReturnValue({ userId: null });
    const res = await request(app)
      .post("/api/v1/photos/presign")
      .send({ mimeType: "image/jpeg" });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid mimeType", async () => {
    authAs("clerk_u1");
    mockPersonFindUnique.mockResolvedValue(PERSON);
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/photos/presign")
      .set("Authorization", "Bearer token")
      .send({ mimeType: "image/gif" });
    expect(res.status).toBe(400);
  });

  it("returns presigned URL for valid mimeType", async () => {
    authAs("clerk_u1");
    mockPersonFindUnique.mockResolvedValue(PERSON);
    mockCreatePresignedUpload.mockResolvedValue({
      uploadUrl: "https://r2.example.com/put?sig=abc",
      key: "abc-123.jpg",
      publicUrl: "https://pub.example.com/abc-123.jpg"
    });
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/photos/presign")
      .set("Authorization", "Bearer token")
      .send({ mimeType: "image/jpeg" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      uploadUrl: "https://r2.example.com/put?sig=abc",
      key: "abc-123.jpg",
      publicUrl: "https://pub.example.com/abc-123.jpg"
    });
  });
});

describe("POST /api/v1/photos/events/:eventId", () => {
  it("returns 404 when event not found", async () => {
    authAs("clerk_u1");
    mockPersonFindUnique.mockResolvedValue(PERSON);
    mockEventFindUnique.mockResolvedValue(null);
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/photos/events/ev1")
      .set("Authorization", "Bearer token")
      .send({ key: "abc.jpg", url: "https://pub.example.com/abc.jpg" });
    expect(res.status).toBe(404);
  });

  it("returns 403 when requester is not a family member", async () => {
    authAs("clerk_u1");
    mockPersonFindUnique.mockResolvedValue(PERSON);
    mockEventFindUnique.mockResolvedValue(EVENT);
    mockFamilyMemberFindUnique.mockResolvedValue(null);
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/photos/events/ev1")
      .set("Authorization", "Bearer token")
      .send({ key: "abc.jpg", url: "https://pub.example.com/abc.jpg" });
    expect(res.status).toBe(403);
  });

  it("creates and returns EventPhoto when requester is a member", async () => {
    authAs("clerk_u1");
    mockPersonFindUnique.mockResolvedValue(PERSON);
    mockEventFindUnique.mockResolvedValue(EVENT);
    mockFamilyMemberFindUnique.mockResolvedValue(FAMILY_MEMBER);
    mockEventPhotoCreate.mockResolvedValue({
      id: "ph1", eventId: "ev1", uploadedById: "p1",
      key: "abc.jpg", url: "https://pub.example.com/abc.jpg",
      createdAt: new Date("2026-04-25T00:00:00Z")
    });
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/photos/events/ev1")
      .set("Authorization", "Bearer token")
      .send({ key: "abc.jpg", url: "https://pub.example.com/abc.jpg" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: "ph1", eventId: "ev1" });
  });
});

describe("GET /api/v1/photos/events/:eventId", () => {
  it("returns 403 when requester is not a family member", async () => {
    authAs("clerk_u1");
    mockPersonFindUnique.mockResolvedValue(PERSON);
    mockEventFindUnique.mockResolvedValue(EVENT);
    mockFamilyMemberFindUnique.mockResolvedValue(null);
    const app = createApp();
    const res = await request(app)
      .get("/api/v1/photos/events/ev1")
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });

  it("returns photo list for family member", async () => {
    authAs("clerk_u1");
    mockPersonFindUnique.mockResolvedValue(PERSON);
    mockEventFindUnique.mockResolvedValue(EVENT);
    mockFamilyMemberFindUnique.mockResolvedValue(FAMILY_MEMBER);
    mockEventPhotoFindMany.mockResolvedValue([
      { id: "ph1", eventId: "ev1", uploadedById: "p1", key: "abc.jpg",
        url: "https://pub.example.com/abc.jpg", createdAt: new Date("2026-04-25T00:00:00Z") }
    ]);
    const app = createApp();
    const res = await request(app)
      .get("/api/v1/photos/events/ev1")
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: "ph1" });
  });
});

describe("DELETE /api/v1/photos/:photoId", () => {
  it("returns 404 when photo not found", async () => {
    authAs("clerk_u1");
    mockPersonFindUnique.mockResolvedValue(PERSON);
    mockEventPhotoFindUnique.mockResolvedValue(null);
    const app = createApp();
    const res = await request(app)
      .delete("/api/v1/photos/ph1")
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(404);
  });

  it("returns 403 when requester did not upload and is not an admin", async () => {
    authAs("clerk_u1");
    mockPersonFindUnique.mockResolvedValue(PERSON);
    mockEventPhotoFindUnique.mockResolvedValue({
      id: "ph1", eventId: "ev1", uploadedById: "p_other",
      key: "abc.jpg", url: "https://pub.example.com/abc.jpg",
      event: { familyGroupId: "fam1" }
    });
    mockFamilyMemberFindUnique.mockResolvedValue({ ...FAMILY_MEMBER, roles: ["MEMBER"] });
    const app = createApp();
    const res = await request(app)
      .delete("/api/v1/photos/ph1")
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });

  it("deletes photo record and R2 object when requester is the uploader", async () => {
    authAs("clerk_u1");
    mockPersonFindUnique.mockResolvedValue(PERSON);
    mockEventPhotoFindUnique.mockResolvedValue({
      id: "ph1", eventId: "ev1", uploadedById: "p1",
      key: "abc.jpg", url: "https://pub.example.com/abc.jpg",
      event: { familyGroupId: "fam1" }
    });
    mockFamilyMemberFindUnique.mockResolvedValue(FAMILY_MEMBER);
    mockEventPhotoDelete.mockResolvedValue({});
    const app = createApp();
    const res = await request(app)
      .delete("/api/v1/photos/ph1")
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(204);
    expect(mockDeleteR2Object).toHaveBeenCalledWith("abc.jpg");
  });
});
