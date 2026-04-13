/**
 * AI Context Assembler (ADR-06)
 *
 * Server-side module that constructs the family context payload sent to the
 * LLM on every AI request. Manages token budget, assembles relevant family
 * data, and enforces privacy boundaries.
 *
 * Privacy rules:
 *  - Cross-family-group access is forbidden (verified before any fetch).
 *  - Persons with ageGateLevel = MINOR are excluded from AI context.
 *  - This module never calls an LLM and never imports the AI SDK.
 */

import { db } from "@famlink/db";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgeGateLevel = "NONE" | "MINOR";

export interface PersonSummary {
  id: string;
  displayName: string;
  relationship: string; // e.g. "PARENT", "SPOUSE", "family member"
  ageGateLevel: AgeGateLevel;
  contactable: boolean; // true if person has email or phone
}

export interface EventSummary {
  id: string;
  title: string;
  startTime: string; // ISO string
  location: string | null;
  rsvpSummary: { yes: number; no: number; maybe: number; pending: number };
}

export interface FamilyContext {
  familyGroupId: string;
  familyName: string;
  requestingPerson: PersonSummary;
  members: PersonSummary[];
  upcomingEvents: EventSummary[];
  upcomingBirthdays: { name: string; date: string; daysUntil: number }[];
  tokenEstimate: number;
}

export interface ContextAssemblyOptions {
  maxMembers?: number;
  eventLookAheadDays?: number;
  maxEvents?: number;
  maxBirthdays?: number;
}

// ── Token budget constants ────────────────────────────────────────────────────

export const MAX_CONTEXT_TOKENS = 4000;
export const TOKENS_PER_MEMBER = 30;
export const TOKENS_PER_EVENT = 50;

const DEFAULT_OPTIONS: Required<ContextAssemblyOptions> = {
  maxMembers: 50,
  eventLookAheadDays: 30,
  maxEvents: 10,
  maxBirthdays: 5
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildDisplayName(person: {
  firstName: string;
  lastName: string;
  preferredName: string | null;
}): string {
  return person.preferredName ?? `${person.firstName} ${person.lastName}`;
}

function calcDaysUntil(dob: Date, now: Date): number {
  const thisYear = now.getFullYear();
  const nextBirthday = new Date(thisYear, dob.getMonth(), dob.getDate());
  if (nextBirthday < now) {
    nextBirthday.setFullYear(thisYear + 1);
  }
  return Math.floor((nextBirthday.getTime() - now.getTime()) / 86_400_000);
}

function estimateTokens(
  members: PersonSummary[],
  events: EventSummary[],
  birthdays: { name: string }[]
): number {
  return (
    200 +
    members.length * TOKENS_PER_MEMBER +
    events.length * TOKENS_PER_EVENT +
    birthdays.length * 15
  );
}

// ── assembleFamilyContext ─────────────────────────────────────────────────────

export async function assembleFamilyContext(
  requestingPersonId: string,
  familyGroupId: string,
  options?: ContextAssemblyOptions
): Promise<FamilyContext> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // 1. Verify membership
  const membership = await db.familyMember.findUnique({
    where: { familyGroupId_personId: { familyGroupId, personId: requestingPersonId } }
  });
  if (!membership) {
    throw new Error("Unauthorized: person is not a member of this family group");
  }

  // 2. Fetch family group
  const familyGroup = await db.familyGroup.findUniqueOrThrow({
    where: { id: familyGroupId }
  });

  // 3. Fetch requesting person
  const requester = await db.person.findUniqueOrThrow({
    where: { id: requestingPersonId }
  });

  // 4. Fetch non-minor family members (limit to maxMembers)
  const memberRows = await db.familyMember.findMany({
    where: { familyGroupId, person: { ageGateLevel: { not: "MINOR" } } },
    include: { person: true },
    take: opts.maxMembers,
    orderBy: { joinedAt: "asc" }
  });

  // Fetch relationships from requester → each member (1 query)
  const relRows = await db.relationship.findMany({
    where: { fromPersonId: requestingPersonId, familyGroupId }
  });
  const relMap = new Map(relRows.map(r => [r.toPersonId, r.type]));

  const members: PersonSummary[] = memberRows
    .filter(m => m.personId !== requestingPersonId)
    .map(m => ({
      id: m.person.id,
      displayName: buildDisplayName(m.person),
      relationship: relMap.get(m.person.id) ?? "family member",
      ageGateLevel: m.person.ageGateLevel as AgeGateLevel,
      contactable: !!(m.person.email ?? m.person.phone)
    }));

  // Build requesting person summary
  const requestingPerson: PersonSummary = {
    id: requester.id,
    displayName: buildDisplayName(requester),
    relationship: "self",
    ageGateLevel: requester.ageGateLevel as AgeGateLevel,
    contactable: !!(requester.email ?? requester.phone)
  };

  // 5. Fetch upcoming events
  const now = new Date();
  const lookAheadEnd = new Date(now.getTime() + opts.eventLookAheadDays * 86_400_000);

  const eventRows = await db.event.findMany({
    where: {
      familyGroupId,
      startAt: { gte: now, lte: lookAheadEnd }
    },
    include: { rsvps: true },
    take: opts.maxEvents,
    orderBy: { startAt: "asc" }
  });

  const upcomingEvents: EventSummary[] = eventRows.map(e => {
    const rsvpCounts = { yes: 0, no: 0, maybe: 0, pending: 0 };
    for (const r of e.rsvps) {
      if (r.status === "YES") rsvpCounts.yes++;
      else if (r.status === "NO") rsvpCounts.no++;
      else if (r.status === "MAYBE") rsvpCounts.maybe++;
      else rsvpCounts.pending++;
    }
    return {
      id: e.id,
      title: e.title,
      startTime: e.startAt.toISOString(),
      location: e.locationName ?? null,
      rsvpSummary: rsvpCounts
    };
  });

  // 6. Upcoming birthdays (within 30 days, sorted ascending)
  const birthdayPersons = memberRows
    .filter(m => m.person.dateOfBirth !== null)
    .map(m => ({
      name: buildDisplayName(m.person),
      dob: m.person.dateOfBirth as Date,
      dateStr: m.person.dateOfBirth!.toISOString().split("T")[0]
    }));

  const upcomingBirthdays = birthdayPersons
    .map(p => ({ name: p.name, date: p.dateStr, daysUntil: calcDaysUntil(p.dob, now) }))
    .filter(b => b.daysUntil <= 30)
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, opts.maxBirthdays);

  // 7 & 8. Token budget
  let tokenEstimate = estimateTokens(members, upcomingEvents, upcomingBirthdays);

  if (tokenEstimate > MAX_CONTEXT_TOKENS) {
    const originalCount = members.length;
    // Remove members from the end (most recently joined = least established)
    while (tokenEstimate > MAX_CONTEXT_TOKENS && members.length > 0) {
      members.pop();
      tokenEstimate = estimateTokens(members, upcomingEvents, upcomingBirthdays);
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[aiContext] Token budget exceeded: trimmed members from ${originalCount} to ${members.length} ` +
      `(estimate: ${estimateTokens(members, upcomingEvents, upcomingBirthdays)} tokens)`
    );
  }

  // 9. Return context
  return {
    familyGroupId,
    familyName: familyGroup.name,
    requestingPerson,
    members,
    upcomingEvents,
    upcomingBirthdays,
    tokenEstimate
  };
}

// ── formatContextForPrompt ────────────────────────────────────────────────────

export function formatContextForPrompt(context: FamilyContext): string {
  const lines: string[] = [];

  lines.push(`Family: ${context.familyName}`);
  lines.push(`Requesting member: ${context.requestingPerson.displayName}`);

  if (context.members.length > 0) {
    const memberNames = context.members.map(m => m.displayName).join(", ");
    lines.push(`Members (${context.members.length}): ${memberNames}`);
  } else {
    lines.push("Members: none");
  }

  if (context.upcomingEvents.length > 0) {
    lines.push("Upcoming Events:");
    for (const e of context.upcomingEvents) {
      const d = new Date(e.startTime);
      const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const rsvp = e.rsvpSummary;
      const location = e.location ? `, ${e.location}` : "";
      lines.push(
        `  - ${e.title} (${dateStr}${location} — ${rsvp.yes} yes, ${rsvp.pending} pending)`
      );
    }
  }

  if (context.upcomingBirthdays.length > 0) {
    lines.push("Upcoming Birthdays:");
    for (const b of context.upcomingBirthdays) {
      const dayLabel = b.daysUntil === 0 ? "today" : b.daysUntil === 1 ? "tomorrow" : `in ${b.daysUntil} days`;
      lines.push(`  - ${b.name}'s birthday is ${dayLabel} (${b.date})`);
    }
  }

  return lines.join("\n");
}

// ── getConversationHistory ────────────────────────────────────────────────────

export async function getConversationHistory(
  conversationId: string,
  limit = 20
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const messages = await db.assistantMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: limit
  });

  return messages.map(m => ({
    role: m.role as "user" | "assistant",
    content: m.content
  }));
}
