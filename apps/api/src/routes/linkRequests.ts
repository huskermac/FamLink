import { Router } from "express";
import { z } from "zod";
import { activeFamilyMembership, hasPermission } from "../lib/familyAccess";
import { billingImpactForAdd } from "../lib/subscriptionEnforcement";
import { deliverConsentLink } from "../lib/consentDelivery";
import {
  AlreadyMember,
  AttestationRequired,
  CarryHouseholdInvalid,
  DataEntryNoConsent,
  RequestAlreadyPending,
  createMembershipRequest,
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

  // HOUSEHOLD_LINK is implemented in Task 8 — dispatch to a temporary 501 now.
  if (body.kind === "HOUSEHOLD_LINK") {
    res.status(501).json({ error: "NOT_IMPLEMENTED" });
    return;
  }

  const requester = personed(req).person;

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
