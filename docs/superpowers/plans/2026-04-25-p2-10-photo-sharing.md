# P2-10: Cloudflare R2 + Photo Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add profile photo upload and event photo gallery to FamLink, using Cloudflare R2 as the storage backend with direct presigned URL uploads from the client.

**Architecture:** Client calls `/api/v1/photos/presign` to receive a short-lived presigned PUT URL, uploads the file directly to R2 (bypassing the API server), then calls the API to confirm/save metadata. Profile photos save via the existing `PUT /api/v1/persons/:personId` endpoint. Event photos save via a new `POST /api/v1/photos/events/:eventId` endpoint backed by a new `EventPhoto` Prisma model.

**Tech Stack:** `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (Cloudflare R2 is S3-compatible), `expo-image-picker` (mobile), Vitest (API + web tests), Jest + Expo preset (mobile tests), NativeWind 4 (mobile styling), Tailwind (web styling).

---

## File Structure

**New files:**
- `apps/api/src/lib/r2.ts` — presign + delete helpers
- `apps/api/src/lib/__tests__/r2.test.ts`
- `apps/api/src/routes/photos.ts` — full photos router
- `apps/api/src/routes/__tests__/photos.test.ts`
- `apps/web/lib/api/photos.ts` — web photo API client
- `apps/web/components/photos/ProfilePhotoUploadButton.tsx`
- `apps/web/components/photos/PhotoGallery.tsx`
- `apps/mobile/hooks/usePhotos.ts`

**Modified files:**
- `packages/db/prisma/schema.prisma` — add `EventPhoto` model + relations
- `apps/api/src/routes/index.ts` — register `photosRouter`
- `apps/api/package.json` — add `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
- `apps/web/lib/api/family.ts` — add `updatePersonPhotoUrl`
- `apps/web/app/(protected)/family/[familyId]/members/[personId]/page.tsx` — photo upload UI
- `apps/web/app/(protected)/events/[eventId]/page.tsx` — Photos tab
- `apps/mobile/hooks/useFamily.ts` — add `useUpdatePersonPhoto` mutation
- `apps/mobile/app/(tabs)/family/[personId].tsx` — photo display + upload
- `apps/mobile/app/(tabs)/events/[eventId].tsx` — Photos section
- `apps/mobile/package.json` — add `expo-image-picker`

---

## Task 1: Prisma — Add EventPhoto model

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Write the failing type check**

Run the current type-check to confirm there is no `EventPhoto` type exported (just to establish baseline):

```bash
cd packages/db && npm run db:generate 2>&1 | head -5
```

Expected: Generates successfully, no EventPhoto in output.

- [ ] **Step 2: Add EventPhoto to schema**

In `packages/db/prisma/schema.prisma`, after the `EventItem` model (line 205), add:

```prisma
model EventPhoto {
  id           String   @id @default(cuid())
  eventId      String
  event        Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  uploadedById String
  uploadedBy   Person   @relation(fields: [uploadedById], references: [id])
  key          String   @unique
  url          String
  createdAt    DateTime @default(now())

  @@index([eventId])
}
```

Also add these two relation fields to the existing models:

In the `Event` model (after `eventItems EventItem[]` on line 155):
```prisma
  eventPhotos EventPhoto[]
```

In the `Person` model (after `assignedEventItems EventItem[] @relation("EventItemAssignee")` on line 35):
```prisma
  uploadedPhotos EventPhoto[]
```

- [ ] **Step 3: Run migration**

```bash
cd packages/db && npm run db:migrate -- --name add_event_photo_model
```

Expected output contains: `The following migration(s) have been applied: 20..._add_event_photo_model`

- [ ] **Step 4: Verify generated client exports EventPhoto**

```bash
cd packages/db && npm run db:generate
```

Expected: Completes without error. `packages/db/src/generated/client` should contain `EventPhoto` type.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat: P2-10 add EventPhoto Prisma model"
```

---

## Task 2: API — Install AWS SDK + R2 utility

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/src/lib/r2.ts`
- Create: `apps/api/src/lib/__tests__/r2.test.ts`

- [ ] **Step 1: Install packages**

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner --workspace=@famlink/api
```

Expected: `package-lock.json` updated, no peer dep errors.

- [ ] **Step 2: Write failing tests**

Create `apps/api/src/lib/__tests__/r2.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSignedUrl = vi.fn();
const mockSend = vi.fn();

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args)
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(() => ({ send: (...args: unknown[]) => mockSend(...args) })),
  PutObjectCommand: vi.fn((params: unknown) => ({ ...(params as object), _type: "PutObjectCommand" })),
  DeleteObjectCommand: vi.fn((params: unknown) => ({ ...(params as object), _type: "DeleteObjectCommand" }))
}));

beforeEach(() => {
  vi.resetAllMocks();
  process.env.CLOUDFLARE_R2_ACCOUNT_ID = "test-account";
  process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = "test-key";
  process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = "test-secret";
  process.env.CLOUDFLARE_R2_BUCKET_NAME = "test-bucket";
  process.env.CLOUDFLARE_R2_PUBLIC_URL = "https://pub.example.com";
  mockGetSignedUrl.mockResolvedValue("https://r2.example.com/presigned-url");
  mockSend.mockResolvedValue({});
});

describe("createPresignedUpload", () => {
  it("returns uploadUrl from getSignedUrl and key with .jpg ext for image/jpeg", async () => {
    const { createPresignedUpload } = await import("../r2");
    const result = await createPresignedUpload("image/jpeg");
    expect(result.uploadUrl).toBe("https://r2.example.com/presigned-url");
    expect(result.key).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(result.publicUrl).toBe(`https://pub.example.com/${result.key}`);
  });

  it("uses .png extension for image/png", async () => {
    const { createPresignedUpload } = await import("../r2");
    const result = await createPresignedUpload("image/png");
    expect(result.key).toMatch(/\.png$/);
  });

  it("uses .jpg extension for image/webp and image/heic", async () => {
    const { createPresignedUpload } = await import("../r2");
    const resultWebp = await createPresignedUpload("image/webp");
    const resultHeic = await createPresignedUpload("image/heic");
    expect(resultWebp.key).toMatch(/\.jpg$/);
    expect(resultHeic.key).toMatch(/\.jpg$/);
  });
});

describe("deleteR2Object", () => {
  it("calls send with DeleteObjectCommand", async () => {
    const { deleteR2Object } = await import("../r2");
    await deleteR2Object("some-key.jpg");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
cd apps/api && npm test -- r2
```

Expected: FAIL — cannot find module `../r2`

- [ ] **Step 4: Implement r2 utility**

Create `apps/api/src/lib/r2.ts`:

```ts
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "node:crypto";

function getR2Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!
    }
  });
}

export async function createPresignedUpload(mimeType: string): Promise<{
  uploadUrl: string;
  key: string;
  publicUrl: string;
}> {
  const bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME!;
  const publicBase = process.env.CLOUDFLARE_R2_PUBLIC_URL!;
  const ext = mimeType === "image/png" ? "png" : "jpg";
  const key = `${crypto.randomUUID()}.${ext}`;
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mimeType });
  const uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 300 });
  const publicUrl = `${publicBase.replace(/\/$/, "")}/${key}`;
  return { uploadUrl, key, publicUrl };
}

export async function deleteR2Object(key: string): Promise<void> {
  const bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME!;
  await getR2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
```

- [ ] **Step 5: Run tests to verify pass**

```bash
cd apps/api && npm test -- r2
```

Expected: PASS — 4 tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/r2.ts apps/api/src/lib/__tests__/r2.test.ts apps/api/package.json package-lock.json
git commit -m "feat: P2-10 R2 presign utility"
```

---

## Task 3: API — Photos router

**Files:**
- Create: `apps/api/src/routes/photos.ts`
- Create: `apps/api/src/routes/__tests__/photos.test.ts`
- Modify: `apps/api/src/routes/index.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/routes/__tests__/photos.test.ts`:

```ts
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
  vi.resetAllMocks();
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
      id: "ph1",
      eventId: "ev1",
      uploadedById: "p1",
      key: "abc.jpg",
      url: "https://pub.example.com/abc.jpg",
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
      { id: "ph1", eventId: "ev1", uploadedById: "p1", key: "abc.jpg", url: "https://pub.example.com/abc.jpg", createdAt: new Date("2026-04-25T00:00:00Z") }
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
```

- [ ] **Step 2: Run to verify failure**

```bash
cd apps/api && npm test -- photos
```

Expected: FAIL — routes for photos not found, 404 responses instead of expected codes

- [ ] **Step 3: Implement photos router**

Create `apps/api/src/routes/photos.ts`:

```ts
import { Router, type Request } from "express";
import { z } from "zod";
import { db } from "@famlink/db";
import type { AuthedRequest } from "../middleware/requireAuth";
import { createPresignedUpload, deleteR2Object } from "../lib/r2";
import { hasAdminRole } from "../lib/familyAccess";

export const photosRouter = Router();

const presignSchema = z.object({
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic"])
});

const confirmPhotoSchema = z.object({
  key: z.string().min(1),
  url: z.string().url()
});

const eventIdParam = z.object({ eventId: z.string().min(1) });
const photoIdParam = z.object({ photoId: z.string().min(1) });

function authed(req: Request): AuthedRequest {
  return req as unknown as AuthedRequest;
}

async function personForClerkUserId(clerkUserId: string) {
  return db.person.findUnique({ where: { userId: clerkUserId } });
}

function serializePhoto(p: {
  id: string;
  eventId: string;
  uploadedById: string;
  key: string;
  url: string;
  createdAt: Date;
}) {
  return {
    id: p.id,
    eventId: p.eventId,
    uploadedById: p.uploadedById,
    key: p.key,
    url: p.url,
    createdAt: p.createdAt.toISOString()
  };
}

/** POST /api/v1/photos/presign */
photosRouter.post("/presign", async (req, res) => {
  const parsed = presignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid mimeType", details: parsed.error.flatten() });
    return;
  }

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: "Person record required" });
    return;
  }

  const result = await createPresignedUpload(parsed.data.mimeType);
  res.json(result);
});

/** POST /api/v1/photos/events/:eventId */
photosRouter.post("/events/:eventId", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid event id" });
    return;
  }
  const { eventId } = p.data;

  const parsed = confirmPhotoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: "Person record required" });
    return;
  }

  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const membership = await db.familyMember.findUnique({
    where: { familyGroupId_personId: { familyGroupId: event.familyGroupId, personId: requester.id } }
  });
  if (!membership) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }

  const photo = await db.eventPhoto.create({
    data: {
      eventId,
      uploadedById: requester.id,
      key: parsed.data.key,
      url: parsed.data.url
    }
  });

  res.status(201).json(serializePhoto(photo));
});

/** GET /api/v1/photos/events/:eventId */
photosRouter.get("/events/:eventId", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid event id" });
    return;
  }
  const { eventId } = p.data;

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: "Person record required" });
    return;
  }

  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const membership = await db.familyMember.findUnique({
    where: { familyGroupId_personId: { familyGroupId: event.familyGroupId, personId: requester.id } }
  });
  if (!membership) {
    res.status(403).json({ error: "Not authorized to view photos for this event" });
    return;
  }

  const photos = await db.eventPhoto.findMany({
    where: { eventId },
    orderBy: { createdAt: "asc" }
  });

  res.json(photos.map(serializePhoto));
});

/** DELETE /api/v1/photos/:photoId */
photosRouter.delete("/:photoId", async (req, res) => {
  const p = photoIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid photo id" });
    return;
  }
  const { photoId } = p.data;

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: "Person record required" });
    return;
  }

  const photo = await db.eventPhoto.findUnique({
    where: { id: photoId },
    include: { event: { select: { familyGroupId: true } } }
  });
  if (!photo) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }

  const isUploader = photo.uploadedById === requester.id;
  if (!isUploader) {
    const membership = await db.familyMember.findUnique({
      where: { familyGroupId_personId: { familyGroupId: photo.event.familyGroupId, personId: requester.id } }
    });
    const isAdmin = membership ? hasAdminRole(membership) : false;
    if (!isAdmin) {
      res.status(403).json({ error: "Only the uploader or a family admin can delete this photo" });
      return;
    }
  }

  await db.eventPhoto.delete({ where: { id: photoId } });
  await deleteR2Object(photo.key);
  res.status(204).send();
});
```

- [ ] **Step 4: Register photosRouter in index.ts**

In `apps/api/src/routes/index.ts`, add after the last `router.use` line:

Old last line:
```ts
router.use("/api/v1/ai", requireAuth, aiRouter);
```

New:
```ts
router.use("/api/v1/ai", requireAuth, aiRouter);
import { photosRouter } from "./photos";
router.use("/api/v1/photos", requireAuth, photosRouter);
```

Wait — imports must be at the top. The actual edit is:

Add to imports at top of `apps/api/src/routes/index.ts` (after the `aiRouter` import line):
```ts
import { photosRouter } from "./photos";
```

Add to body at bottom (after `router.use("/api/v1/ai", requireAuth, aiRouter);`):
```ts
router.use("/api/v1/photos", requireAuth, photosRouter);
```

- [ ] **Step 5: Run tests to verify pass**

```bash
cd apps/api && npm test -- photos
```

Expected: PASS — all 8 tests pass

- [ ] **Step 6: Run full API test suite**

```bash
cd apps/api && npm test
```

Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/photos.ts apps/api/src/routes/__tests__/photos.test.ts apps/api/src/routes/index.ts
git commit -m "feat: P2-10 photos API router (presign, confirm, list, delete)"
```

---

## Task 4: Web — Photo API client + family.ts update

**Files:**
- Create: `apps/web/lib/api/photos.ts`
- Modify: `apps/web/lib/api/family.ts`

- [ ] **Step 1: Create photos API client**

Create `apps/web/lib/api/photos.ts`:

```ts
import { apiFetch } from "@/lib/api";

type GetToken = () => Promise<string | null>;

export interface PresignResponse {
  uploadUrl: string;
  key: string;
  publicUrl: string;
}

export interface EventPhoto {
  id: string;
  eventId: string;
  uploadedById: string;
  key: string;
  url: string;
  createdAt: string;
}

export async function presignUpload(
  mimeType: string,
  getToken: GetToken
): Promise<PresignResponse> {
  return apiFetch<PresignResponse>("/api/v1/photos/presign", {
    getToken,
    method: "POST",
    body: JSON.stringify({ mimeType })
  });
}

export async function uploadToR2(
  uploadUrl: string,
  file: File,
  mimeType: string
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: file
  });
  if (!res.ok) {
    throw new Error(`R2 upload failed: ${res.status}`);
  }
}

export async function confirmEventPhoto(
  eventId: string,
  key: string,
  url: string,
  getToken: GetToken
): Promise<EventPhoto> {
  return apiFetch<EventPhoto>(`/api/v1/photos/events/${encodeURIComponent(eventId)}`, {
    getToken,
    method: "POST",
    body: JSON.stringify({ key, url })
  });
}

export async function getEventPhotos(
  eventId: string,
  getToken: GetToken
): Promise<EventPhoto[]> {
  return apiFetch<EventPhoto[]>(`/api/v1/photos/events/${encodeURIComponent(eventId)}`, {
    getToken,
    method: "GET"
  });
}

export async function deletePhoto(
  photoId: string,
  getToken: GetToken
): Promise<void> {
  return apiFetch(`/api/v1/photos/${encodeURIComponent(photoId)}`, {
    getToken,
    method: "DELETE"
  });
}
```

- [ ] **Step 2: Add updatePersonPhotoUrl to family.ts**

In `apps/web/lib/api/family.ts`, after the `updatePerson` function (after line 110), add:

```ts
export function updatePersonPhotoUrl(
  personId: string,
  profilePhotoUrl: string,
  getToken: GetToken
): Promise<PersonBrief> {
  return apiFetch<PersonBrief>(`/api/v1/persons/${encodeURIComponent(personId)}`, {
    getToken,
    method: "PUT",
    body: JSON.stringify({ profilePhotoUrl })
  });
}
```

- [ ] **Step 3: Type-check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/api/photos.ts apps/web/lib/api/family.ts
git commit -m "feat: P2-10 web photo API client"
```

---

## Task 5: Web — Profile photo upload UI

**Files:**
- Create: `apps/web/components/photos/ProfilePhotoUploadButton.tsx`
- Modify: `apps/web/app/(protected)/family/[familyId]/members/[personId]/page.tsx`

- [ ] **Step 1: Create ProfilePhotoUploadButton component**

Create `apps/web/components/photos/ProfilePhotoUploadButton.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import { presignUpload, uploadToR2 } from "@/lib/api/photos";
import { updatePersonPhotoUrl } from "@/lib/api/family";

interface Props {
  personId: string;
}

export function ProfilePhotoUploadButton({ personId }: Props) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const mimeType = file.type as "image/jpeg" | "image/png" | "image/webp";
    setUploading(true);
    setError(null);
    try {
      const { uploadUrl, publicUrl } = await presignUpload(mimeType, getToken);
      await uploadToR2(uploadUrl, file, mimeType);
      await updatePersonPhotoUrl(personId, publicUrl, getToken);
      await qc.invalidateQueries({ queryKey: ["person", personId] });
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFile}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 hover:bg-indigo-500"
      >
        {uploading ? "Uploading…" : "Change photo"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Add upload button to person profile page**

In `apps/web/app/(protected)/family/[familyId]/members/[personId]/page.tsx`, update the return JSX.

Current file (read before editing): the file uses `PersonHeader` and shows `person.dateOfBirth`.

Add import at top of file:
```tsx
import { ProfilePhotoUploadButton } from "@/components/photos/ProfilePhotoUploadButton";
```

Replace the `<PersonHeader person={person} />` line with:
```tsx
<div className="flex items-end gap-4">
  <PersonHeader person={person} />
  <ProfilePhotoUploadButton personId={personId} />
</div>
```

- [ ] **Step 3: Type-check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/photos/ProfilePhotoUploadButton.tsx apps/web/app/\(protected\)/family/\[familyId\]/members/\[personId\]/page.tsx
git commit -m "feat: P2-10 web profile photo upload UI"
```

---

## Task 6: Web — Event photo gallery

**Files:**
- Create: `apps/web/components/photos/PhotoGallery.tsx`
- Modify: `apps/web/app/(protected)/events/[eventId]/page.tsx`

- [ ] **Step 1: Create PhotoGallery component**

Create `apps/web/components/photos/PhotoGallery.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  presignUpload,
  uploadToR2,
  confirmEventPhoto,
  getEventPhotos,
  deletePhoto,
  type EventPhoto
} from "@/lib/api/photos";

interface Props {
  eventId: string;
}

export function PhotoGallery({ eventId }: Props) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: photos = [], isLoading } = useQuery({
    queryKey: ["event-photos", eventId],
    queryFn: () => getEventPhotos(eventId, getToken)
  });

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const mimeType = file.type as "image/jpeg" | "image/png" | "image/webp";
    setUploading(true);
    setError(null);
    try {
      const { uploadUrl, key, publicUrl } = await presignUpload(mimeType, getToken);
      await uploadToR2(uploadUrl, file, mimeType);
      await confirmEventPhoto(eventId, key, publicUrl, getToken);
      await qc.invalidateQueries({ queryKey: ["event-photos", eventId] });
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete(photo: EventPhoto) {
    try {
      await deletePhoto(photo.id, getToken);
      await qc.invalidateQueries({ queryKey: ["event-photos", eventId] });
    } catch {
      setError("Delete failed. Please try again.");
    }
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-md bg-slate-700" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Photos ({photos.length})
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFile}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 hover:bg-indigo-500"
        >
          {uploading ? "Uploading…" : "Add photo"}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {photos.length === 0 ? (
        <p className="text-sm text-slate-500 italic">No photos yet.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <div key={photo.id} className="group relative aspect-square">
              <img
                src={photo.url}
                alt="Event photo"
                className="h-full w-full rounded-md object-cover"
              />
              <button
                onClick={() => handleDelete(photo)}
                className="absolute right-1 top-1 hidden rounded-full bg-black/60 px-1.5 py-0.5 text-xs text-white group-hover:block"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add Photos tab to event detail page**

In `apps/web/app/(protected)/events/[eventId]/page.tsx`:

Add import at top (after existing imports):
```tsx
import { PhotoGallery } from "@/components/photos/PhotoGallery";
```

Change the `Tab` type from:
```tsx
type Tab = "details" | "attendees" | "organizer";
```
to:
```tsx
type Tab = "details" | "attendees" | "photos" | "organizer";
```

In the `tabs` array, add after the `attendees` entry (before `organizer`):
```tsx
{ id: "photos", label: "Photos", show: true },
```

After the `{activeTab === "attendees" && ...}` block, add:
```tsx
{activeTab === "photos" && (
  <PhotoGallery eventId={eventId} />
)}
```

- [ ] **Step 3: Type-check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/photos/PhotoGallery.tsx apps/web/app/\(protected\)/events/\[eventId\]/page.tsx
git commit -m "feat: P2-10 web event photo gallery"
```

---

## Task 7: Mobile — Install expo-image-picker + photo hooks

**Files:**
- Modify: `apps/mobile/package.json`
- Create: `apps/mobile/hooks/usePhotos.ts`
- Modify: `apps/mobile/hooks/useFamily.ts`

- [ ] **Step 1: Install expo-image-picker**

```bash
npm install expo-image-picker --workspace=famlink-mobile
```

Expected: `package-lock.json` updated.

- [ ] **Step 2: Create usePhotos hook**

Create `apps/mobile/hooks/usePhotos.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiFetch } from "../lib/api";

export interface EventPhoto {
  id: string;
  eventId: string;
  uploadedById: string;
  key: string;
  url: string;
  createdAt: string;
}

export function useEventPhotos(eventId: string) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["event-photos", eventId],
    queryFn: () => apiFetch<EventPhoto[]>(`/api/v1/photos/events/${eventId}`)
  });
}

export function useUploadEventPhoto(eventId: string) {
  const apiFetch = useApiFetch();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ uri, mimeType }: { uri: string; mimeType: string }) => {
      const { uploadUrl, key, publicUrl } = await apiFetch<{
        uploadUrl: string;
        key: string;
        publicUrl: string;
      }>("/api/v1/photos/presign", {
        method: "POST",
        body: JSON.stringify({ mimeType })
      });

      const fileRes = await fetch(uri);
      const blob = await fileRes.blob();
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: blob
      });
      if (!uploadRes.ok) {
        throw new Error(`R2 upload failed: ${uploadRes.status}`);
      }

      return apiFetch<EventPhoto>(`/api/v1/photos/events/${eventId}`, {
        method: "POST",
        body: JSON.stringify({ key, url: publicUrl })
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["event-photos", eventId] });
    }
  });
}

export function useDeletePhoto(eventId: string) {
  const apiFetch = useApiFetch();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) =>
      apiFetch(`/api/v1/photos/${photoId}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["event-photos", eventId] });
    }
  });
}
```

- [ ] **Step 3: Add useUpdatePersonPhoto to useFamily.ts**

In `apps/mobile/hooks/useFamily.ts`, add this import at the top (after the existing imports):

The file already imports `useQuery` and `useApiFetch`. Add `useMutation, useQueryClient` to the tanstack import:

Change:
```ts
import { useQuery } from "@tanstack/react-query";
```
to:
```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
```

Then add this function at the end of the file:

```ts
export function useUpdatePersonPhoto(personId: string) {
  const apiFetch = useApiFetch();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ uri, mimeType }: { uri: string; mimeType: string }) => {
      const { uploadUrl, publicUrl } = await apiFetch<{
        uploadUrl: string;
        key: string;
        publicUrl: string;
      }>("/api/v1/photos/presign", {
        method: "POST",
        body: JSON.stringify({ mimeType })
      });

      const fileRes = await fetch(uri);
      const blob = await fileRes.blob();
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: blob
      });
      if (!uploadRes.ok) {
        throw new Error(`R2 upload failed: ${uploadRes.status}`);
      }

      return apiFetch<PersonBrief>(`/api/v1/persons/${personId}`, {
        method: "PUT",
        body: JSON.stringify({ profilePhotoUrl: publicUrl })
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["person", personId] });
      void qc.invalidateQueries({ queryKey: ["me"] });
    }
  });
}
```

Note: `PersonBrief` is already defined in `useFamily.ts` (the interface at line 4).

- [ ] **Step 4: Run mobile tests**

```bash
cd apps/mobile && npm test
```

Expected: All existing tests pass. (No new tests to write for hooks — UI tested manually via Expo Go)

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/hooks/usePhotos.ts apps/mobile/hooks/useFamily.ts apps/mobile/package.json package-lock.json
git commit -m "feat: P2-10 mobile photo hooks"
```

---

## Task 8: Mobile — Profile photo on person screen

**Files:**
- Modify: `apps/mobile/app/(tabs)/family/[personId].tsx`

- [ ] **Step 1: Update person profile screen**

In `apps/mobile/app/(tabs)/family/[personId].tsx`, replace the full file contents.

The current file (read from the repo) shows an initials-only avatar and no upload affordance. The new version adds:
- Show `<Image>` when `person.profilePhotoUrl` is set
- Show initials avatar when no photo
- "Change photo" button (only visible when viewing own profile) using `expo-image-picker`

Replace the entire file with:

```tsx
import {
  View, Text, ScrollView, ActivityIndicator,
  TouchableOpacity, Image, Alert
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { usePerson, usePersonRelationships, useMyPerson, useUpdatePersonPhoto } from "../../../hooks/useFamily";
import type { ReactElement } from "react";

const RELATIONSHIP_LABELS: Record<string, string> = {
  SPOUSE: "Spouse", PARTNER: "Partner", EX_SPOUSE: "Ex-spouse",
  PARENT: "Parent", CHILD: "Child", STEP_PARENT: "Step-parent",
  STEP_CHILD: "Step-child", ADOPTIVE_PARENT: "Adoptive parent",
  ADOPTIVE_CHILD: "Adoptive child", SIBLING: "Sibling",
  HALF_SIBLING: "Half-sibling", STEP_SIBLING: "Step-sibling",
  GRANDPARENT: "Grandparent", GRANDCHILD: "Grandchild",
  AUNT_UNCLE: "Aunt/Uncle", NIECE_NEPHEW: "Niece/Nephew",
  COUSIN: "Cousin", CAREGIVER: "Caregiver",
  GUARDIAN: "Guardian", FAMILY_FRIEND: "Family friend"
};

export default function PersonProfile(): ReactElement {
  const { personId } = useLocalSearchParams<{ personId: string }>();
  const personQuery = usePerson(personId);
  const relQuery = usePersonRelationships(personId);
  const meQuery = useMyPerson();
  const uploadMutation = useUpdatePersonPhoto(personId);

  if (personQuery.isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  const person = personQuery.data;
  if (!person) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center px-6">
        <Text className="text-slate-400 text-center">Person not found.</Text>
      </View>
    );
  }

  const isSelf = meQuery.data?.id === person.id;
  const name = person.preferredName?.trim() || `${person.firstName} ${person.lastName}`.trim();
  const dob = person.dateOfBirth
    ? new Date(person.dateOfBirth).toLocaleDateString(undefined, {
        year: "numeric", month: "long", day: "numeric"
      })
    : null;

  async function handlePickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Allow access to photos to change your profile photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? "image/jpeg";
    uploadMutation.mutate({ uri: asset.uri, mimeType });
  }

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 24 }}>
      <View className="items-center mb-8">
        {person.profilePhotoUrl ? (
          <Image
            source={{ uri: person.profilePhotoUrl }}
            style={{ width: 80, height: 80, borderRadius: 40, marginBottom: 16 }}
          />
        ) : (
          <View className="w-20 h-20 rounded-full bg-indigo-600 items-center justify-center mb-4">
            <Text className="text-white text-3xl font-semibold">
              {person.firstName[0]}{person.lastName[0]}
            </Text>
          </View>
        )}
        {isSelf && (
          <TouchableOpacity
            onPress={handlePickPhoto}
            disabled={uploadMutation.isPending}
            style={{ opacity: uploadMutation.isPending ? 0.5 : 1 }}
          >
            <Text className="text-indigo-400 text-sm">
              {uploadMutation.isPending ? "Uploading…" : "Change photo"}
            </Text>
          </TouchableOpacity>
        )}
        <Text className="text-slate-50 text-xl font-bold mt-2">{name}</Text>
        {name !== `${person.firstName} ${person.lastName}`.trim() && (
          <Text className="text-slate-400 text-sm mt-1">
            {person.firstName} {person.lastName}
          </Text>
        )}
      </View>

      {dob && (
        <View className="bg-slate-800 rounded-xl px-4 py-3 mb-4">
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-1">Birthday</Text>
          <Text className="text-slate-50">{dob}</Text>
        </View>
      )}

      {relQuery.data && relQuery.data.length > 0 && (
        <View className="bg-slate-800 rounded-xl px-4 py-3">
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">Relationships</Text>
          {relQuery.data.map((rel, i, arr) => (
            <View
              key={rel.id}
              className={`flex-row justify-between py-2${i < arr.length - 1 ? " border-b border-slate-700" : ""}`}
            >
              <Text className="text-slate-50">{rel.relatedPerson.displayName}</Text>
              <Text className="text-slate-400 text-sm">
                {RELATIONSHIP_LABELS[rel.type] ?? rel.type}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
```

- [ ] **Step 2: Run mobile tests**

```bash
cd apps/mobile && npm test
```

Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/\(tabs\)/family/\[personId\].tsx
git commit -m "feat: P2-10 mobile profile photo upload"
```

---

## Task 9: Mobile — Event photo gallery

**Files:**
- Modify: `apps/mobile/app/(tabs)/events/[eventId].tsx`

- [ ] **Step 1: Update event detail screen**

In `apps/mobile/app/(tabs)/events/[eventId].tsx`, replace the full file contents:

```tsx
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, FlatList, Alert
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useEvent, useRsvp, useClaimItem } from "../../../hooks/useEvents";
import { useMyPerson } from "../../../hooks/useFamily";
import { useEventPhotos, useUploadEventPhoto, useDeletePhoto } from "../../../hooks/usePhotos";
import type { SerializedEventItem } from "../../../hooks/useEvents";
import type { ReactElement } from "react";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit"
  });
}

export default function EventDetail(): ReactElement {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const myPersonQuery = useMyPerson();
  const myPersonId = myPersonQuery.data?.id ?? null;
  const eventQuery = useEvent(eventId);
  const rsvpMutation = useRsvp(eventId);
  const claimMutation = useClaimItem(eventId);
  const photosQuery = useEventPhotos(eventId);
  const uploadPhotoMutation = useUploadEventPhoto(eventId);
  const deletePhotoMutation = useDeletePhoto(eventId);

  if (eventQuery.isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  if (!eventQuery.data) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center px-6">
        <Text className="text-slate-400 text-center">Event not found.</Text>
      </View>
    );
  }

  const { event, rsvps, eventItems } = eventQuery.data;

  function handleClaim(item: SerializedEventItem) {
    if (!myPersonId || claimMutation.isPending) return;
    claimMutation.mutate({ itemId: item.id, personId: myPersonId, currentItems: eventItems });
  }

  async function handleAddPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Allow access to photos to add event photos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? "image/jpeg";
    uploadPhotoMutation.mutate({ uri: asset.uri, mimeType });
  }

  const photos = photosQuery.data ?? [];

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 24 }}>
      {/* Event header */}
      <Text className="text-slate-50 text-xl font-bold mb-2">{event.title}</Text>
      <Text className="text-slate-400 mb-4">{formatDateTime(event.startAt)}</Text>
      {event.locationName && (
        <Text className="text-slate-400 mb-4">📍 {event.locationName}</Text>
      )}
      {event.description && (
        <Text className="text-slate-300 mb-6">{event.description}</Text>
      )}

      {/* RSVP */}
      <View className="mb-8">
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">Your RSVP</Text>
        <View className="flex-row gap-3">
          {(["YES", "NO", "MAYBE"] as const).map((status) => (
            <TouchableOpacity
              key={status}
              onPress={() => rsvpMutation.mutate(status)}
              disabled={rsvpMutation.isPending}
              style={{
                opacity: rsvpMutation.isPending ? 0.5 : 1,
                backgroundColor:
                  status === "YES" ? "#15803d20" : status === "NO" ? "#b91c1c20" : "#92400e20",
                flex: 1, paddingVertical: 8, borderRadius: 8,
                alignItems: "center", borderWidth: 1, borderColor: "#334155"
              }}
            >
              <Text
                className={`font-semibold text-sm ${
                  status === "YES" ? "text-green-400" : status === "NO" ? "text-red-400" : "text-amber-400"
                }`}
              >
                {status === "YES" ? "✓ Yes" : status === "NO" ? "✗ No" : "? Maybe"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text className="text-slate-500 text-sm mt-3">
          {rsvps.YES} yes · {rsvps.NO} no · {rsvps.MAYBE} maybe · {rsvps.PENDING} pending
        </Text>
      </View>

      {/* EventItems */}
      {eventItems.length > 0 && (
        <View className="mb-8">
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">What to bring</Text>
          {eventItems.map((item) => (
            <View
              key={item.id}
              className="bg-slate-800 rounded-xl px-4 py-3 mb-2 flex-row items-center justify-between"
            >
              <View className="flex-1 mr-3">
                <Text className="text-slate-50 font-medium">{item.name}</Text>
                {item.quantity && <Text className="text-slate-400 text-sm">{item.quantity}</Text>}
                {item.assignedToPersonId && (
                  <Text className="text-green-400 text-xs mt-1">Claimed</Text>
                )}
              </View>
              {item.status === "UNCLAIMED" && (
                <TouchableOpacity
                  onPress={() => handleClaim(item)}
                  disabled={claimMutation.isPending}
                  style={{
                    opacity: claimMutation.isPending ? 0.5 : 1,
                    backgroundColor: "#4f46e5",
                    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6
                  }}
                >
                  <Text style={{ color: "#fff", fontSize: 14, fontWeight: "500" }}>Claim</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Photos */}
      <View>
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-slate-400 text-xs uppercase tracking-wider">
            Photos ({photos.length})
          </Text>
          <TouchableOpacity
            onPress={handleAddPhoto}
            disabled={uploadPhotoMutation.isPending}
            style={{
              opacity: uploadPhotoMutation.isPending ? 0.5 : 1,
              backgroundColor: "#4f46e5",
              borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6
            }}
          >
            <Text style={{ color: "#fff", fontSize: 13, fontWeight: "500" }}>
              {uploadPhotoMutation.isPending ? "Uploading…" : "+ Add photo"}
            </Text>
          </TouchableOpacity>
        </View>
        {photos.length === 0 ? (
          <Text className="text-slate-500 text-sm italic">No photos yet.</Text>
        ) : (
          <FlatList
            data={photos}
            keyExtractor={(p) => p.id}
            numColumns={3}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <TouchableOpacity
                onLongPress={() =>
                  Alert.alert("Delete photo?", undefined, [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () => deletePhotoMutation.mutate(item.id)
                    }
                  ])
                }
                style={{ flex: 1 / 3, aspectRatio: 1, padding: 2 }}
              >
                <Image
                  source={{ uri: item.url }}
                  style={{ flex: 1, borderRadius: 6 }}
                  resizeMode="cover"
                />
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </ScrollView>
  );
}
```

- [ ] **Step 2: Run mobile tests**

```bash
cd apps/mobile && npm test
```

Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/\(tabs\)/events/\[eventId\].tsx
git commit -m "feat: P2-10 mobile event photo gallery"
```

---

## Task 10: Environment variables + final verification

**Files:**
- None — env var documentation only

- [ ] **Step 1: Add env vars to .env.example (if it exists)**

Check if `apps/api/.env.example` exists:
```bash
ls apps/api/.env.example 2>/dev/null || echo "not found"
```

If it exists, add these lines:
```
CLOUDFLARE_R2_ACCOUNT_ID=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_BUCKET_NAME=
CLOUDFLARE_R2_PUBLIC_URL=
```

- [ ] **Step 2: Run full test suite**

```bash
npm run test --workspaces
```

Expected: All tests pass across API, web, and mobile.

- [ ] **Step 3: Run API type-check**

```bash
cd apps/api && npm run type-check
```

Expected: No errors

- [ ] **Step 4: Run web type-check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "chore: P2-10 env var documentation"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Profile photo upload (web + mobile) — Tasks 5 + 8
- ✅ Event photo gallery upload (web + mobile) — Tasks 6 + 9
- ✅ Cloudflare R2 storage — Task 2
- ✅ Presigned URL flow — Task 3 (API) + Tasks 4–9 (client)
- ✅ EventPhoto model — Task 1
- ✅ Tests for all new API routes — Task 3
- ✅ `PUT /api/v1/persons/:personId` already accepts `profilePhotoUrl` — no changes needed to persons.ts

**Confirmed no placeholders:** All code blocks are complete and reference types/functions defined in earlier tasks.

**Type consistency:**
- `EventPhoto` (serialized) shape is consistent across: API `serializePhoto()`, `apps/web/lib/api/photos.ts`, and `apps/mobile/hooks/usePhotos.ts`
- `presignUpload` returns `{ uploadUrl, key, publicUrl }` consistently used across web and mobile hooks
- `useUpdatePersonPhoto` references `PersonBrief` which is defined at line 4 of `useFamily.ts`
