import { Router } from "express";
import { db } from "@famlink/db";
import { grantMembershipInTx, resolveExpiry } from "../lib/linkRequest";
import { guestRateLimiter } from "../middleware/rateLimit";

export const consentRouter = Router();

// Public, token-authorized — rate-limit per IP (token enumeration / abuse).
consentRouter.use(guestRateLimiter);

/**
 * GET /api/v1/consent/:token — names-only view for the passive-target consent
 * page. Never echoes the token back in the response body. 410 on an expired
 * request (resolved on read, mirroring the in-app inbox's expiry sweep).
 */
consentRouter.get("/:token", async (req, res) => {
  const { token } = req.params;
  const r = await db.linkRequest.findUnique({ where: { token } });
  if (!r) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  const fresh = await resolveExpiry(r);
  if (fresh.status === "EXPIRED") {
    res.status(410).json({ error: "This request has expired" });
    return;
  }

  const [family, target] = await Promise.all([
    db.familyGroup.findUnique({ where: { id: fresh.familyGroupId }, select: { name: true } }),
    fresh.targetPersonId
      ? db.person.findUnique({ where: { id: fresh.targetPersonId }, select: { firstName: true, preferredName: true } })
      : null
  ]);

  res.json({
    familyName: family?.name ?? "A family",
    targetName: target ? (target.preferredName ?? target.firstName) : null,
    status: fresh.status,
    notice: "Accepting adds you to this family. Linked families' admins can edit shared household details."
  });
});

/**
 * POST /api/v1/consent/:token/accept — authorized by possession of the token
 * (404 if no such request). Grant + contact-verification stamp run in ONE
 * transaction via `grantMembershipInTx`, so a verify failure would roll the
 * grant back too. The stamp targets ONLY the exact contact the token was
 * delivered to (`deliveredContact`), never whatever the person's current
 * contact happens to be — if it changed since delivery, membership is still
 * granted but the verification stamp is skipped. Single-use falls out of the
 * conditional claim inside `grantMembershipInTx` (a second call -> count 0 ->
 * 409 with the current state).
 */
consentRouter.post("/:token/accept", async (req, res) => {
  const { token } = req.params;
  const r = await db.linkRequest.findUnique({ where: { token } });
  if (!r || !r.targetPersonId) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  const channel = r.tokenChannel === "SMS" ? "SMS" : "EMAIL";
  const granted = await db.$transaction(async (tx) => {
    const ok = await grantMembershipInTx(tx, r, r.targetPersonId!, channel);
    if (!ok) return false; // already resolved or expired — the claim inside enforces status + expiry
    // Verify ONLY the exact contact the token was delivered to (r.deliveredContact), NOT
    // whatever the person's current contact is. If they changed that contact after
    // delivery, possession of this token no longer proves control of the current one, so
    // grant membership but skip the verification stamp.
    if (r.deliveredContact) {
      const person = await tx.person.findUnique({ where: { id: r.targetPersonId! } });
      if (r.tokenChannel === "SMS" && (person?.phone === r.deliveredContact || person?.phoneNormalized === r.deliveredContact)) {
        await tx.person.update({ where: { id: r.targetPersonId! }, data: { phoneVerifiedAt: new Date() } });
      } else if (
        r.tokenChannel === "EMAIL" &&
        (person?.email === r.deliveredContact || person?.emailNormalized === r.deliveredContact)
      ) {
        await tx.person.update({ where: { id: r.targetPersonId! }, data: { emailVerifiedAt: new Date() } });
      }
    }
    return true;
  });

  if (!granted) {
    const fresh = await db.linkRequest.findUnique({ where: { id: r.id } });
    res.status(409).json({ granted: false, status: fresh?.status });
    return;
  }
  res.json({ granted: true, status: "ACCEPTED" });
});
