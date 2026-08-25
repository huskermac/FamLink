import crypto from "crypto";
import { db } from "@famlink/db";
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
