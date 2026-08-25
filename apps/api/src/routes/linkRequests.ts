import { Router } from "express";
import { z } from "zod";
import { db } from "@famlink/db";
import { activeFamilyMembership, hasPermission } from "../lib/familyAccess";
import { billingImpactForAdd } from "../lib/subscriptionEnforcement";
import { deliverConsentLink } from "../lib/consentDelivery";
import {
  AlreadyMember,
  AttestationRequired,
  CarryHouseholdInvalid,
  DataEntryNoConsent,
  HouseholdNotVisible,
  NotInitiatingAdmin,
  RequestAlreadyPending,
  canConsentHousehold,
  canConsentMembership,
  claimAndAcceptHousehold,
  claimAndAcceptMembership,
  createHouseholdLinkRequest,
  createMembershipRequest,
  grantMembershipInTx,
  recheckMembershipConsentTx,
  resolveExpiry,
  serializeInboxRequest,
  serializeOwnerRequest
} from "../lib/linkRequest";
import { personed } from "../middleware/requireAuth";

export const linkRequestsRouter = Router();

// Route shape (documented deviation from the spec's /families/:id/link-requests): one router
// at /api/v1/link-requests with the family id IN THE BODY, so the family-agnostic inbox,
// accept, and decline (Task 5+) can live alongside create without a :familyId param.
const CreateLinkRequestSchema = z
  .object({
    kind: z.enum(["FAMILY_MEMBERSHIP", "HOUSEHOLD_LINK"]),
    direction: z.enum(["PULL", "JOIN"]),
    familyGroupId: z.string().min(1),
    targetPersonId: z.string().min(1).optional(),
    targetEmail: z.string().email().optional(),
    targetPhone: z.string().min(1).optional(),
    targetHouseholdId: z.string().min(1).optional(),
    carryHouseholdId: z.string().min(1).optional(),
    attestedAdult: z.boolean().optional()
  })
  .superRefine((body, ctx) => {
    const hasPersonId = body.targetPersonId !== undefined;
    const hasContact = body.targetEmail !== undefined || body.targetPhone !== undefined;
    const hasAnyTarget = hasPersonId || hasContact;

    if (body.kind === "FAMILY_MEMBERSHIP") {
      if (body.targetHouseholdId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targetHouseholdId"],
          message: "targetHouseholdId is not valid for FAMILY_MEMBERSHIP"
        });
      }
      if (body.direction === "PULL") {
        if (hasPersonId === hasContact) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["targetPersonId"],
            message: "PULL requires exactly one of targetPersonId or a contact (targetEmail/targetPhone)"
          });
        }
      } else if (hasAnyTarget) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targetPersonId"],
          message: "JOIN requests must not specify a target — the requester is the target"
        });
      }
    } else {
      // HOUSEHOLD_LINK
      if (hasAnyTarget) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targetPersonId"],
          message: "HOUSEHOLD_LINK requests must not specify a person or contact target"
        });
      }
      if (body.targetHouseholdId === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targetHouseholdId"],
          message: "targetHouseholdId is required for HOUSEHOLD_LINK"
        });
      }
    }
  });

linkRequestsRouter.post("/", async (req, res, next) => {
  const parsed = CreateLinkRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  const requester = personed(req).person;

  if (body.kind === "HOUSEHOLD_LINK") {
    try {
      const request = await createHouseholdLinkRequest({
        familyGroupId: body.familyGroupId,
        requester: { id: requester.id },
        targetHouseholdId: body.targetHouseholdId!,
        direction: body.direction
      });
      res.status(201).json(serializeOwnerRequest(request));
    } catch (e) {
      if (e instanceof NotInitiatingAdmin) {
        res.status(403).json({ error: "NOT_AUTHORIZED" });
        return;
      }
      if (e instanceof HouseholdNotVisible) {
        res.status(403).json({ error: "HOUSEHOLD_NOT_VISIBLE" });
        return;
      }
      if (e instanceof RequestAlreadyPending) {
        res.status(409).json({ error: "REQUEST_ALREADY_PENDING" });
        return;
      }
      next(e);
    }
    return;
  }

  // Requester authorization: PULL needs an INVITE_MEMBERS admin of familyGroupId; JOIN needs
  // only an authenticated person (the applicant IS the target, enforced in createMembershipRequest).
  if (body.direction === "PULL") {
    const membership = await activeFamilyMembership(body.familyGroupId, requester.id);
    if (!membership || !hasPermission(membership, "INVITE_MEMBERS")) {
      res.status(403).json({ error: "Not authorized to invite members to this family" });
      return;
    }
  }

  try {
    const { request, cls } = await createMembershipRequest({
      familyGroupId: body.familyGroupId,
      direction: body.direction,
      requester: { id: requester.id },
      target:
        body.direction === "PULL"
          ? { personId: body.targetPersonId, email: body.targetEmail, phone: body.targetPhone }
          : undefined,
      carryHouseholdId: body.carryHouseholdId,
      attestedAdult: body.attestedAdult
    });

    // Best-effort passive-target delivery: a delivery failure must never fail the 201.
    if (cls.kind === "TOKEN") {
      try {
        await deliverConsentLink({ request, personId: cls.personId });
      } catch (err) {
        console.error(`deliverConsentLink failed for LinkRequest ${request.id}:`, err);
      }
    }

    const responseBody: ReturnType<typeof serializeOwnerRequest> & { billingImpact?: unknown } =
      serializeOwnerRequest(request);
    // Billing disclosure ONLY for an active-account (IN_APP) PULL create — a passive TOKEN
    // target stays userId:null and doesn't raise billable headcount until it claims an
    // account, and a JOIN applicant must never see the family's billing.
    if (body.direction === "PULL" && cls.kind === "IN_APP") {
      responseBody.billingImpact = await billingImpactForAdd(body.familyGroupId);
    }

    res.status(201).json(responseBody);
  } catch (e) {
    if (e instanceof DataEntryNoConsent) {
      res.status(409).json({ error: "DATA_ENTRY_NO_CONSENT" });
      return;
    }
    if (e instanceof RequestAlreadyPending) {
      res.status(409).json({ error: "REQUEST_ALREADY_PENDING" });
      return;
    }
    if (e instanceof AlreadyMember) {
      res.status(409).json({ error: "ALREADY_MEMBER" });
      return;
    }
    if (e instanceof CarryHouseholdInvalid) {
      res.status(400).json({ error: "CARRY_HOUSEHOLD_INVALID" });
      return;
    }
    if (e instanceof AttestationRequired) {
      res.status(400).json({ error: "ATTESTATION_REQUIRED" });
      return;
    }
    next(e);
  }
});

// GET /pending must be registered before any /:id route so it is never captured as an id segment.
linkRequestsRouter.get("/pending", async (req, res) => {
  const requester = personed(req).person;

  // Families the requester admins — feeds both the JOIN-counterparty branch and the
  // in-family-minor guardian branch below.
  const adminMemberships = await db.familyMember.findMany({
    where: { personId: requester.id, roles: { has: "ADMIN" }, suspendedAt: null },
    select: { familyGroupId: true }
  });
  const adminFamilyIds = adminMemberships.map((m) => m.familyGroupId);

  // Guardian targets, pre-queried as id lists rather than a `targetPerson` relation, so
  // LinkRequest.targetPersonId stays a logical (no-FK) column per the HouseholdAuditEntry
  // convention. Two cases: a minor who is a member of a family the requester admins, and a
  // family-less minor whose guardianPersonId is the requester.
  const inFamilyMinors = await db.familyMember.findMany({
    where: { familyGroupId: { in: adminFamilyIds }, person: { ageGateLevel: { in: ["TEEN", "CHILD"] } } },
    select: { personId: true }
  });
  const familyLessWards = await db.person.findMany({
    where: { guardianPersonId: requester.id, familyMemberships: { none: {} } },
    select: { id: true }
  });
  const guardianTargetIds = [...inFamilyMinors.map((m) => m.personId), ...familyLessWards.map((p) => p.id)];

  const membershipRows = await db.linkRequest.findMany({
    where: {
      kind: "FAMILY_MEMBERSHIP",
      status: "PENDING",
      expiresAt: { gt: new Date() },
      OR: [
        { targetPersonId: requester.id },
        { direction: "JOIN", familyGroupId: { in: adminFamilyIds } },
        { targetPersonId: { in: guardianTargetIds } }
      ]
    }
  });

  // Household requests: households currently linked to a family the requester admins — feeds
  // the household-consent-family check (Task 8).
  const adminHouseholds = await db.householdFamily.findMany({
    where: { familyGroupId: { in: adminFamilyIds } },
    select: { householdId: true }
  });
  const adminHouseholdIds = adminHouseholds.map((h) => h.householdId);
  const householdRows = await db.linkRequest.findMany({
    where: {
      kind: "HOUSEHOLD_LINK",
      status: "PENDING",
      expiresAt: { gt: new Date() },
      targetHouseholdId: { in: adminHouseholdIds }
    }
  });

  // Never resolveExpiry-mutate on read — expired rows are already excluded by expiresAt:{gt:now}.
  const authorizedMembership: typeof membershipRows = [];
  for (const r of membershipRows) {
    if (await canConsentMembership(r, requester)) authorizedMembership.push(r);
  }
  const authorizedHousehold: typeof householdRows = [];
  for (const r of householdRows) {
    if (await canConsentHousehold(r, requester)) authorizedHousehold.push(r);
  }
  const serialized = await Promise.all(
    [...authorizedMembership, ...authorizedHousehold].map((r) => serializeInboxRequest(r))
  );
  res.json({ requests: serialized });
});

linkRequestsRouter.post("/:id/accept", async (req, res) => {
  const consenter = personed(req).person;
  const row = await db.linkRequest.findUnique({ where: { id: req.params.id } });
  if (!row) {
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }

  if (row.kind === "HOUSEHOLD_LINK") {
    // claimAndAcceptHousehold re-validates BOTH the consenter's linked-family admin authority and
    // the PENDING+non-expired status INSIDE its own locked transaction, so there is no separate
    // pre-check here: UNAUTHORIZED covers both "never had authority" and "lost it since request".
    const outcome = await claimAndAcceptHousehold(row, { id: consenter.id });
    if (outcome === "UNAUTHORIZED") {
      res.status(403).json({ error: "NOT_AUTHORIZED" }); // never serialize state on lost/absent authority
      return;
    }
    const current = (await db.linkRequest.findUnique({ where: { id: row.id } }))!;
    res.status(200).json({
      id: current.id,
      status: current.status,
      granted: outcome === "GRANTED",
      resolvedAt: current.resolvedAt?.toISOString() ?? null
    });
    return;
  }

  // Authorize on the RAW row FIRST — resolveExpiry mutates, so it must run after the check,
  // otherwise a foreign caller who guesses an expired id flips it to EXPIRED for free.
  const authorized = await canConsentMembership(row, consenter);
  if (!authorized) {
    res.status(403).json({ error: "NOT_AUTHORIZED" });
    return;
  }

  const fresh = await resolveExpiry(row);
  if (fresh.status !== "PENDING") {
    res.status(200).json({
      id: fresh.id,
      status: fresh.status,
      granted: false,
      resolvedAt: fresh.resolvedAt?.toISOString() ?? null
    });
    return;
  }

  const isSelf = consenter.id === fresh.targetPersonId;
  let granted: boolean;
  if (isSelf) {
    // Self-accept: authority is identity and cannot change between the check and the claim.
    granted = await claimAndAcceptMembership(fresh, consenter.id, "IN_APP");
  } else {
    // JOIN or minor-guardian accept: the authority is role-derived and can change, so re-check
    // it inside the same tx as the claim.
    const outcome = await db.$transaction(async (tx) => {
      const stillAuthorized = await recheckMembershipConsentTx(tx, fresh, consenter.id);
      if (!stillAuthorized) return "UNAUTHORIZED" as const;
      const ok = await grantMembershipInTx(tx, fresh, consenter.id, "IN_APP");
      return ok ? ("GRANTED" as const) : ("RESOLVED" as const);
    });
    if (outcome === "UNAUTHORIZED") {
      res.status(403).json({ error: "NOT_AUTHORIZED" });
      return;
    }
    granted = outcome === "GRANTED";
  }

  const current = (await db.linkRequest.findUnique({ where: { id: fresh.id } }))!;
  res.status(200).json({
    id: current.id,
    status: current.status,
    granted,
    resolvedAt: current.resolvedAt?.toISOString() ?? null
  });
});

linkRequestsRouter.post("/:id/decline", async (req, res) => {
  const consenter = personed(req).person;
  const row = await db.linkRequest.findUnique({ where: { id: req.params.id } });
  if (!row) {
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }

  const authorized =
    row.kind === "HOUSEHOLD_LINK" ? await canConsentHousehold(row, consenter) : await canConsentMembership(row, consenter);
  if (!authorized) {
    res.status(403).json({ error: "NOT_AUTHORIZED" });
    return;
  }

  const fresh = await resolveExpiry(row);
  if (fresh.status !== "PENDING") {
    res.status(200).json({
      id: fresh.id,
      status: fresh.status,
      resolvedAt: fresh.resolvedAt?.toISOString() ?? null
    });
    return;
  }

  await db.linkRequest.updateMany({
    where: { id: fresh.id, status: "PENDING" },
    data: { status: "DECLINED", consentedByPersonId: consenter.id, consentChannel: "IN_APP", resolvedAt: new Date() }
  });

  const current = (await db.linkRequest.findUnique({ where: { id: fresh.id } }))!;
  res.status(200).json({
    id: current.id,
    status: current.status,
    resolvedAt: current.resolvedAt?.toISOString() ?? null
  });
});
