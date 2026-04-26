import { Router, type Request } from "express";
import { z } from "zod";
import { db } from "@famlink/db";
import type { AuthedRequest } from "../middleware/requireAuth";
import { createPresignedUpload, deleteR2Object } from "../lib/r2";
import { hasAdminRole } from "../lib/familyAccess";
import { ERROR_PERSON_RECORD_REQUIRED } from "../lib/personRequiredMessages";

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
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
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
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
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
    data: { eventId, uploadedById: requester.id, key: parsed.data.key, url: parsed.data.url }
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
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
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
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
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
