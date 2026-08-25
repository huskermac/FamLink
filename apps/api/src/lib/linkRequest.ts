import crypto from "crypto";
import { db, type LinkRequest } from "@famlink/db";
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
// serializeInboxRequest (names only) is defined in Task 5.
