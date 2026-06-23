import { Router } from "express";
import { z } from "zod";
import { db } from "@famlink/db";
import { personed } from "../middleware/requireAuth";
import { createPresignedUpload, deleteR2Object, publicUrlForKey, uploadKeyPrefix } from "../lib/r2";
import { activeFamilyMembership, hasAdminRole } from "../lib/familyAccess";

export const photosRouter = Router();

const presignSchema = z.object({
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic"])
});

// The URL is derived server-side from the key — never trusted from the client.
const confirmPhotoSchema = z.object({
  key: z.string().min(1)
});

const eventIdParam = z.object({ eventId: z.string().min(1) });
const photoIdParam = z.object({ photoId: z.string().min(1) });

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

  // Person presence is guaranteed by requirePerson; presign needs no further checks.
  const requester = personed(req).person;
  const result = await createPresignedUpload(parsed.data.mimeType, requester.id);
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

  const requester = personed(req).person;

  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const membership = await activeFamilyMembership(event.familyGroupId, requester.id);
  if (!membership) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }

  // The key must be one this requester presigned (scoped to their prefix) — a
  // client cannot confirm an arbitrary object. The URL is derived, never trusted.
  if (!parsed.data.key.startsWith(uploadKeyPrefix(requester.id))) {
    res.status(400).json({ error: "Invalid upload key" });
    return;
  }
  const url = publicUrlForKey(parsed.data.key);

  const photo = await db.eventPhoto.create({
    data: { eventId, uploadedById: requester.id, key: parsed.data.key, url }
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

  const requester = personed(req).person;

  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const membership = await activeFamilyMembership(event.familyGroupId, requester.id);
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

  const requester = personed(req).person;

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
    const membership = await activeFamilyMembership(photo.event.familyGroupId, requester.id);
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
