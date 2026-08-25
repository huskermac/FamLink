import crypto from "crypto";
import { db, type LinkRequest, type Prisma } from "@famlink/db";
import { activeFamilyMembership, hasAdminRole } from "./familyAccess";
import { writeHouseholdAudit } from "./householdAccess";
import { findOrCreatePersonByContact } from "./personIdentity";

export type MembershipTargetClass =
  | { kind: "DATA_ENTRY"; personId: string }
  | { kind: "IN_APP"; personId: string; minor: boolean }
  | { kind: "TOKEN"; personId: string };
export type LinkRequestDirection = "PULL" | "JOIN";
export type ConsentChannel = "IN_APP" | "SMS" | "EMAIL";

export const LINK_REQUEST_TTL_DAYS = 30;

export function isMinorLevel(l: string): boolean {
  return l === "TEEN" || l === "CHILD";
}
export function isAdultLevel(l: string): boolean {
  return l === "ADULT";
}
export function generateConsentToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hasAnyContact(p: {
  email: string | null;
  phone: string | null;
  emailNormalized: string | null;
  phoneNormalized: string | null;
}): boolean {
  return Boolean(p.email || p.phone || p.emailNormalized || p.phoneNormalized);
}

/** A never-onboarded person with no contact by any of the 4 fields — the only class of
 *  Person a family may direct-add without going through the link-request consent flow. */
export function isPassiveNoContact(p: {
  userId: string | null;
  email: string | null;
  phone: string | null;
  emailNormalized: string | null;
  phoneNormalized: string | null;
}): boolean {
  return p.userId === null && !hasAnyContact(p);
}

export async function classifyMembershipTarget(input: {
  personId?: string;
  email?: string;
  phone?: string;
}): Promise<MembershipTargetClass> {
  const person = input.personId
    ? await db.person.findUnique({ where: { id: input.personId } })
    : await findOrCreatePersonByContact({ email: input.email, phone: input.phone });
  if (!person) throw new Error("target person not found");
  if (person.userId) return { kind: "IN_APP", personId: person.id, minor: isMinorLevel(person.ageGateLevel) };
  return hasAnyContact(person) ? { kind: "TOKEN", personId: person.id } : { kind: "DATA_ENTRY", personId: person.id };
}

export class DataEntryNoConsent extends Error {}
export class RequestAlreadyPending extends Error {}
export class AttestationRequired extends Error {}
export class AlreadyMember extends Error {}
export class CarryHouseholdInvalid extends Error {}

/** [R3] Sweep an expired-but-still-PENDING duplicate so it cannot block the partial-unique index. */
export async function sweepExpiredMembershipPending(
  familyGroupId: string,
  targetPersonId: string
): Promise<void> {
  await db.linkRequest.updateMany({
    where: {
      kind: "FAMILY_MEMBERSHIP",
      familyGroupId,
      targetPersonId,
      status: "PENDING",
      expiresAt: { lt: new Date() }
    },
    data: { status: "EXPIRED", resolvedAt: new Date() }
  });
}

export async function createMembershipRequest(params: {
  familyGroupId: string;
  direction: LinkRequestDirection;
  requester: { id: string };
  target?: { personId?: string; email?: string; phone?: string };
  carryHouseholdId?: string;
  attestedAdult?: boolean;
}): Promise<{ request: LinkRequest; cls: MembershipTargetClass }> {
  // JOIN: the requester IS the target (a person asks to join `familyGroupId`).
  const target = params.direction === "JOIN" ? { personId: params.requester.id } : (params.target ?? {});
  const cls = await classifyMembershipTarget(target);
  if (cls.kind === "DATA_ENTRY") throw new DataEntryNoConsent();

  // [council MAJOR] a consent request for an already-granted membership is meaningless — reject it.
  const existingMember = await db.familyMember.findUnique({
    where: { familyGroupId_personId: { familyGroupId: params.familyGroupId, personId: cls.personId } }
  });
  if (existingMember) throw new AlreadyMember();

  // [council BLOCKER] validate carryHouseholdId at CREATE time. The inbox resolves and shows the
  // household name, so an unvalidated foreign id leaks that name to the counterparty. It must be
  // a household currently linked to the requesting family.
  if (params.carryHouseholdId) {
    const linked = await db.householdFamily.findUnique({
      where: {
        householdId_familyGroupId: { householdId: params.carryHouseholdId, familyGroupId: params.familyGroupId }
      }
    });
    if (!linked) throw new CarryHouseholdInvalid();
  }

  const targetPerson = await db.person.findUnique({ where: { id: cls.personId } });
  const minor = targetPerson ? isMinorLevel(targetPerson.ageGateLevel) : false;

  // Attestation-before-minor ordering [R2/R3]: a known minor never uses a token and never
  // uses attestation (guardian consents in-app). Attestation applies ONLY to a DOB-unknown
  // passive TOKEN target treated as an adult (spec §11).
  if (cls.kind === "TOKEN" && !minor && !targetPerson?.dateOfBirth && !params.attestedAdult) {
    throw new AttestationRequired();
  }

  const useToken = cls.kind === "TOKEN" && !minor; // minors: guardian in-app, never a token
  await sweepExpiredMembershipPending(params.familyGroupId, cls.personId);
  try {
    const request = await db.linkRequest.create({
      data: {
        kind: "FAMILY_MEMBERSHIP",
        direction: params.direction,
        familyGroupId: params.familyGroupId,
        targetPersonId: cls.personId,
        carryHouseholdId: params.carryHouseholdId ?? null,
        requestedByPersonId: params.requester.id,
        status: "PENDING",
        consentChannel: minor || cls.kind === "IN_APP" ? "IN_APP" : null,
        token: useToken ? generateConsentToken() : null,
        attestedAdult: params.attestedAdult ?? false,
        expiresAt: new Date(Date.now() + LINK_REQUEST_TTL_DAYS * 86_400_000)
      }
    });
    return { request, cls };
  } catch (e) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") {
      throw new RequestAlreadyPending();
    }
    throw e;
  }
}

export function serializeOwnerRequest(r: LinkRequest) {
  /* requester-facing: own ids OK */
  return {
    id: r.id,
    kind: r.kind,
    direction: r.direction,
    familyGroupId: r.familyGroupId,
    targetPersonId: r.targetPersonId,
    targetHouseholdId: r.targetHouseholdId,
    status: r.status,
    consentChannel: r.consentChannel,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null
  };
}

/** Conditional expiry: never clobbers a concurrently-resolved row. Returns the fresh row. */
export async function resolveExpiry(r: LinkRequest): Promise<LinkRequest> {
  if (r.status !== "PENDING" || r.expiresAt.getTime() >= Date.now()) return r;
  await db.linkRequest.updateMany({
    where: { id: r.id, status: "PENDING" },
    data: { status: "EXPIRED", resolvedAt: new Date() }
  });
  return (await db.linkRequest.findUnique({ where: { id: r.id } }))!;
}

/** §6.3 membership matrix. PULL: active adult → self; minor → ADULT non-suspended admin of a family the
 *  minor belongs to, or (family-less minor) the ADULT `guardianPersonId`. JOIN: any admin of the target
 *  family. A requester may consent only when they ALSO hold the counterparty authority (dual-authority). */
export async function canConsentMembership(r: LinkRequest, person: { id: string }): Promise<boolean> {
  if (r.kind !== "FAMILY_MEMBERSHIP" || !r.targetPersonId) return false;
  if (r.direction === "JOIN") {
    const m = await activeFamilyMembership(r.familyGroupId, person.id);
    return Boolean(m && hasAdminRole(m)); // accepting-family admin; the applicant is not an admin here
  }
  const target = await db.person.findUnique({ where: { id: r.targetPersonId } });
  if (!target) return false;
  if (isAdultLevel(target.ageGateLevel)) {
    if (person.id === r.requestedByPersonId && person.id !== target.id) return false; // pure requester cannot self-accept
    return person.id === target.id;
  }
  // minor → ADULT, non-suspended admin of a family the minor belongs to
  const actor = await db.person.findUnique({ where: { id: person.id } });
  if (!actor || !isAdultLevel(actor.ageGateLevel)) return false;
  const adminMemberships = await db.familyMember.findMany({
    where: { personId: person.id, suspendedAt: null, familyGroup: { members: { some: { personId: target.id } } } }
  });
  if (adminMemberships.some(hasAdminRole)) return true;
  const minorFamilies = await db.familyMember.count({ where: { personId: target.id } });
  return minorFamilies === 0 && target.guardianPersonId === person.id;
}

/** The tx-scoped mirror of the JOIN/guardian (role-derived) branches of `canConsentMembership`,
 *  re-checked inside the grant transaction because that authority can change between the initial
 *  check and the claim. Never called for the self-accept branch — that authority is identity. */
export async function recheckMembershipConsentTx(
  tx: Prisma.TransactionClient,
  r: LinkRequest,
  personId: string
): Promise<boolean> {
  if (r.kind !== "FAMILY_MEMBERSHIP" || !r.targetPersonId) return false;
  if (r.direction === "JOIN") {
    const m = await tx.familyMember.findFirst({
      where: { familyGroupId: r.familyGroupId, personId, suspendedAt: null }
    });
    return Boolean(m && hasAdminRole(m));
  }
  // minor-guardian (this fn is only called on the non-self, role-derived branches)
  const target = await tx.person.findUnique({ where: { id: r.targetPersonId } });
  if (!target) return false;
  const actor = await tx.person.findUnique({ where: { id: personId } });
  if (!actor || !isAdultLevel(actor.ageGateLevel)) return false;
  const adminMemberships = await tx.familyMember.findMany({
    where: { personId, suspendedAt: null, familyGroup: { members: { some: { personId: target.id } } } }
  });
  if (adminMemberships.some(hasAdminRole)) return true;
  const minorFamilies = await tx.familyMember.count({ where: { personId: target.id } });
  return minorFamilies === 0 && target.guardianPersonId === personId;
}

/** The grant core, on a caller-supplied tx. The conditional claim re-checks status AND expiry
 *  [council BLOCKER: expiry was not enforced by the claim], so an expired-but-unswept row is never
 *  granted. Returns true if THIS call did the grant. No Stripe call. Exported so the token-accept
 *  path (Task 6) can run the grant and the contact-verification stamp in ONE transaction. */
export async function grantMembershipInTx(
  tx: Prisma.TransactionClient,
  r: LinkRequest,
  consentedByPersonId: string,
  channel: ConsentChannel
): Promise<boolean> {
  const claim = await tx.linkRequest.updateMany({
    where: { id: r.id, status: "PENDING", expiresAt: { gt: new Date() } },
    data: { status: "ACCEPTED", consentedByPersonId, consentChannel: channel, resolvedAt: new Date() }
  });
  if (claim.count === 0) return false; // another caller resolved it, or it expired — no double grant
  await tx.familyMember.upsert({
    where: { familyGroupId_personId: { familyGroupId: r.familyGroupId, personId: r.targetPersonId! } },
    create: { familyGroupId: r.familyGroupId, personId: r.targetPersonId!, roles: ["MEMBER"], permissions: [] },
    update: {}
  });
  if (r.carryHouseholdId) {
    const valid = await tx.householdFamily.findUnique({
      where: { householdId_familyGroupId: { householdId: r.carryHouseholdId, familyGroupId: r.familyGroupId } }
    });
    if (valid) {
      await tx.householdMember.upsert({
        where: { householdId_personId: { householdId: r.carryHouseholdId, personId: r.targetPersonId! } },
        create: { householdId: r.carryHouseholdId, personId: r.targetPersonId! },
        update: {}
      });
    } else {
      await tx.linkRequest.update({ where: { id: r.id }, data: { carryInSkipped: true } }); // [R2] record, not silent
    }
  }
  return true;
}

/** In-app accept wrapper. Idempotent. No Stripe call. */
export async function claimAndAcceptMembership(
  r: LinkRequest,
  consentedByPersonId: string,
  channel: ConsentChannel
): Promise<boolean> {
  return db.$transaction((tx) => grantMembershipInTx(tx, r, consentedByPersonId, channel));
}

/** Names-only inbox serializer — no ids, no roster, no token, for the counterparty's eyes. */
export async function serializeInboxRequest(r: LinkRequest): Promise<{
  id: string;
  kind: string;
  direction: string;
  requestingFamilyName: string;
  targetName: string | null;
  targetHouseholdName?: string | null;
  carryHouseholdName: string | null;
  notice: string;
}> {
  const fam = await db.familyGroup.findUnique({ where: { id: r.familyGroupId }, select: { name: true } });
  const target = r.targetPersonId
    ? await db.person.findUnique({ where: { id: r.targetPersonId }, select: { firstName: true, preferredName: true } })
    : null;
  const carry = r.carryHouseholdId
    ? await db.household.findUnique({ where: { id: r.carryHouseholdId }, select: { name: true } })
    : null;
  const base = {
    id: r.id,
    kind: r.kind,
    direction: r.direction,
    requestingFamilyName: fam?.name ?? "A family",
    targetName: target ? (target.preferredName ?? target.firstName) : null, // [R3] names-only "who" for the counterparty
    carryHouseholdName: carry?.name ?? null, // [R2] carry-in disclosed to the target
    notice: "Accepting adds you to this family. Linked families' admins can edit shared household details."
  };
  // targetHouseholdName is added ONLY for HOUSEHOLD_LINK rows — omitted (not null) for
  // FAMILY_MEMBERSHIP rows so the existing names-only shape stays byte-for-byte unchanged.
  if (r.kind === "HOUSEHOLD_LINK" && r.targetHouseholdId) {
    const targetHousehold = await db.household.findUnique({
      where: { id: r.targetHouseholdId },
      select: { name: true }
    });
    return { ...base, targetHouseholdName: targetHousehold?.name ?? null };
  }
  return base;
}

// ---------------------------------------------------------------------------
// HOUSEHOLD_LINK (Task 8): family-to-family household linking via the same
// consent-request pipeline, PULL (a family with visibility asks a household in)
// or JOIN (a family asks to join a household it already knows the id of).
// ---------------------------------------------------------------------------

export class HouseholdNotVisible extends Error {}
export class NotInitiatingAdmin extends Error {}

export async function createHouseholdLinkRequest(params: {
  familyGroupId: string;
  requester: { id: string };
  targetHouseholdId: string;
  direction: LinkRequestDirection;
}): Promise<LinkRequest> {
  // [council BLOCKER] the requester must be an admin of the INITIATING family (`familyGroupId`) — for BOTH
  // directions. Without this, JOIN lets any authenticated person open a request on an arbitrary family, and
  // PULL only proved the family can see H, not that the requester belongs to that family.
  const initiating = await activeFamilyMembership(params.familyGroupId, params.requester.id);
  if (!initiating || !hasAdminRole(initiating)) throw new NotInitiatingAdmin();
  // PULL precondition: the initiating family must SEE H through a resident who is a member of it. [R2 BLOCKER #10]
  if (params.direction === "PULL") {
    const sees = await db.householdMember.findFirst({
      where: {
        householdId: params.targetHouseholdId,
        person: { familyMemberships: { some: { familyGroupId: params.familyGroupId, suspendedAt: null } } }
      }
    });
    if (!sees) throw new HouseholdNotVisible();
  }
  const already = await db.householdFamily.findUnique({
    where: {
      householdId_familyGroupId: { householdId: params.targetHouseholdId, familyGroupId: params.familyGroupId }
    }
  });
  if (already) throw new RequestAlreadyPending();
  // [R3] sweep an expired-but-still-PENDING duplicate so it cannot block the partial-unique index
  await db.linkRequest.updateMany({
    where: {
      kind: "HOUSEHOLD_LINK",
      familyGroupId: params.familyGroupId,
      targetHouseholdId: params.targetHouseholdId,
      status: "PENDING",
      expiresAt: { lt: new Date() }
    },
    data: { status: "EXPIRED", resolvedAt: new Date() }
  });
  try {
    return await db.linkRequest.create({
      data: {
        kind: "HOUSEHOLD_LINK",
        direction: params.direction,
        familyGroupId: params.familyGroupId,
        targetHouseholdId: params.targetHouseholdId,
        requestedByPersonId: params.requester.id,
        status: "PENDING",
        expiresAt: new Date(Date.now() + LINK_REQUEST_TTL_DAYS * 86_400_000)
      }
    });
  } catch (e) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") {
      throw new RequestAlreadyPending();
    }
    throw e;
  }
}

/** Counterparty = admin of a family CURRENTLY linked to H. Dual-authority allowed (requester can also qualify). */
export async function householdConsentFamily(householdId: string, personId: string): Promise<string | null> {
  const memberships = await db.familyMember.findMany({
    where: {
      personId,
      suspendedAt: null,
      familyGroup: { householdLinks: { some: { householdId } } }
    }
  });
  const admin = memberships.find(hasAdminRole);
  return admin ? admin.familyGroupId : null;
}

export async function canConsentHousehold(r: LinkRequest, person: { id: string }): Promise<boolean> {
  if (r.kind !== "HOUSEHOLD_LINK" || !r.targetHouseholdId) return false;
  return (await householdConsentFamily(r.targetHouseholdId, person.id)) !== null; // dual-authority: no requester exclusion
}

/** [council MAJOR] distinct outcomes so the route never treats lost authority as idempotent success. */
export type HouseholdAcceptOutcome = "GRANTED" | "RESOLVED" | "UNAUTHORIZED";

export async function claimAndAcceptHousehold(
  r: LinkRequest,
  consenter: { id: string }
): Promise<HouseholdAcceptOutcome> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Household" WHERE "id" = ${r.targetHouseholdId} FOR UPDATE`;
    // Re-validate authority AND pending status UNDER the lock. [R2 BLOCKER #11]
    const stillAdmin = await tx.familyMember.findFirst({
      where: {
        personId: consenter.id,
        suspendedAt: null,
        familyGroup: { householdLinks: { some: { householdId: r.targetHouseholdId! } } },
        roles: { has: "ADMIN" }
      }
    });
    if (!stillAdmin) return "UNAUTHORIZED"; // lost authority — the route returns 403, NOT idempotent success
    // The claim re-checks status AND expiry under the lock. [council BLOCKER: expiry must be enforced by the claim]
    const claim = await tx.linkRequest.updateMany({
      where: { id: r.id, status: "PENDING", expiresAt: { gt: new Date() } },
      data: { status: "ACCEPTED", consentedByPersonId: consenter.id, consentChannel: "IN_APP", resolvedAt: new Date() }
    });
    if (claim.count === 0) return "RESOLVED"; // already resolved or expired — the route returns the current state
    const existing = await tx.householdFamily.findUnique({
      where: { householdId_familyGroupId: { householdId: r.targetHouseholdId!, familyGroupId: r.familyGroupId } }
    });
    if (!existing) {
      await tx.householdFamily.create({
        data: { householdId: r.targetHouseholdId!, familyGroupId: r.familyGroupId, linkedByPersonId: consenter.id }
      });
      await writeHouseholdAudit(tx, {
        householdId: r.targetHouseholdId!,
        actorPersonId: consenter.id,
        actorFamilyGroupId: stillAdmin.familyGroupId, // [R2 MAJOR] consenter's family, not the initiator's
        action: "LINKED"
      });
    }
    return "GRANTED";
  });
}
