/**
 * AI Layer 1 Tool Registry (ADR-06)
 *
 * All 10 Layer 1 tools: 9 read-only + 1 write (propose/confirm guardrail).
 * Privacy rules:
 *  - MINOR-gated persons are excluded from all responses.
 *  - Cross-family-group access is forbidden (familyGroupId checked in every tool).
 *  - create_event NEVER writes to the database — it returns a proposal only.
 *
 * AI SDK v6: uses `inputSchema` (not `parameters`). When OUTPUT isn't `never`,
 * the `execute` property is available — pass explicit generics to `tool<I, O>`.
 */

import { tool } from "ai";
import { z } from "zod";
import { db } from "@famlink/db";
import type { PersonSummary, EventSummary } from "./aiContext";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildDisplayName(person: {
  firstName: string;
  lastName: string;
  preferredName: string | null;
}): string {
  return person.preferredName ?? `${person.firstName} ${person.lastName}`;
}

function toPersonSummary(person: {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  ageGateLevel: string;
  email: string | null;
  phone: string | null;
}, relationship = "family member"): PersonSummary {
  return {
    id: person.id,
    displayName: buildDisplayName(person),
    relationship,
    ageGateLevel: person.ageGateLevel as "NONE" | "MINOR",
    contactable: !!(person.email ?? person.phone)
  };
}

// ── WITH RECURSIVE CTE ────────────────────────────────────────────────────────

interface RelPathRow {
  type_path: string[];
  depth: number;
}

function describeRelationshipPath(typePath: string[]): string {
  if (typePath.length === 0) return "related";
  if (typePath.length === 1) return typePath[0].toLowerCase();
  return typePath.map(t => t.toLowerCase()).join(" → ");
}

// ── Input / output types ──────────────────────────────────────────────────────

const GetPersonSchema = z.object({
  name: z.string().describe("First name, preferred name, or partial name to search for"),
  familyGroupId: z.string()
});
type GetPersonInput = z.infer<typeof GetPersonSchema>;

const GetFamilyMembersSchema = z.object({ familyGroupId: z.string() });
type GetFamilyMembersInput = z.infer<typeof GetFamilyMembersSchema>;

const GetRelationshipPathSchema = z.object({
  fromPersonId: z.string(),
  toPersonId: z.string(),
  familyGroupId: z.string()
});
type GetRelationshipPathInput = z.infer<typeof GetRelationshipPathSchema>;

const GetUpcomingBirthdaysSchema = z.object({
  familyGroupId: z.string(),
  withinDays: z.number().int().min(1).max(365).describe("How many days ahead to look")
});
type GetUpcomingBirthdaysInput = z.infer<typeof GetUpcomingBirthdaysSchema>;

const GetUpcomingEventsSchema = z.object({
  familyGroupId: z.string(),
  withinDays: z.number().int().min(1).max(365).optional().describe("How many days ahead (default 30)")
});
type GetUpcomingEventsInput = z.infer<typeof GetUpcomingEventsSchema>;

const GetEventDetailsSchema = z.object({ eventId: z.string(), familyGroupId: z.string() });
type GetEventDetailsInput = z.infer<typeof GetEventDetailsSchema>;

const GetRsvpStatusSchema = z.object({ eventId: z.string(), familyGroupId: z.string() });
type GetRsvpStatusInput = z.infer<typeof GetRsvpStatusSchema>;

const GetHouseholdMembersSchema = z.object({ householdId: z.string(), familyGroupId: z.string() });
type GetHouseholdMembersInput = z.infer<typeof GetHouseholdMembersSchema>;

const GetContactInfoSchema = z.object({ personId: z.string(), familyGroupId: z.string() });
type GetContactInfoInput = z.infer<typeof GetContactInfoSchema>;

const CreateEventSchema = z.object({
  title: z.string(),
  startTime: z.string().describe("ISO datetime"),
  endTime: z.string().optional().describe("ISO datetime"),
  location: z.string().optional(),
  description: z.string().optional(),
  familyGroupId: z.string()
});
type CreateEventInput = z.infer<typeof CreateEventSchema>;

// ── Output types ──────────────────────────────────────────────────────────────

type RelPathResult = { path: string[] | null; description: string };
type BirthdayResult = { name: string; date: string; daysUntil: number }[];
type EventDetailsResult = {
  id: string; title: string; description: string | null;
  startTime: string; endTime: string | null; location: string | null;
  rsvps: { status: string; personName: string }[];
} | null;
type RsvpStatusResult = { yes: string[]; no: string[]; maybe: string[]; pending: string[] } | null;
type ContactInfoResult = { displayName: string; email: string | null; phone: string | null } | null;
type CreateEventResult = {
  proposed: true;
  event: { title: string; startTime: string; endTime: string | null; location: string | null; description: string | null; familyGroupId: string };
  confirmationRequired: true;
  message: string;
};

// ── Tools ─────────────────────────────────────────────────────────────────────

export const get_person = tool<GetPersonInput, PersonSummary[]>({
  description: "Look up a person by name or relationship label within a family group.",
  inputSchema: GetPersonSchema,
  execute: async ({ name, familyGroupId }) => {
    const members = await db.familyMember.findMany({
      where: { familyGroupId, person: { ageGateLevel: { not: "MINOR" } } },
      include: { person: true },
      take: 50
    });

    const lower = name.toLowerCase();
    return members
      .filter(m => {
        const p = m.person;
        return (
          p.firstName.toLowerCase().includes(lower) ||
          p.lastName.toLowerCase().includes(lower) ||
          (p.preferredName?.toLowerCase().includes(lower) ?? false)
        );
      })
      .slice(0, 5)
      .map(m => toPersonSummary(m.person));
  }
});

export const get_family_members = tool<GetFamilyMembersInput, PersonSummary[]>({
  description: "List all non-minor members of a family group.",
  inputSchema: GetFamilyMembersSchema,
  execute: async ({ familyGroupId }) => {
    const members = await db.familyMember.findMany({
      where: { familyGroupId, person: { ageGateLevel: { not: "MINOR" } } },
      include: { person: true },
      orderBy: { joinedAt: "asc" }
    });
    return members.map(m => toPersonSummary(m.person));
  }
});

export const get_relationship_path = tool<GetRelationshipPathInput, RelPathResult>({
  description: "Explain how two people are related within a family group using multi-hop traversal.",
  inputSchema: GetRelationshipPathSchema,
  execute: async ({ fromPersonId, toPersonId, familyGroupId }) => {
    const maxDepth = 4;

    const rows = await db.$queryRaw<RelPathRow[]>`
      WITH RECURSIVE relationship_path AS (
        SELECT
          r."fromPersonId",
          r."toPersonId",
          r."type",
          1                                      AS depth,
          ARRAY[r."fromPersonId", r."toPersonId"] AS path,
          ARRAY[r."type"]                        AS type_path
        FROM "Relationship" r
        WHERE r."fromPersonId" = ${fromPersonId}
          AND r."familyGroupId" = ${familyGroupId}

        UNION ALL

        SELECT
          r."fromPersonId",
          r."toPersonId",
          r."type",
          rp.depth + 1,
          rp.path || r."toPersonId",
          rp.type_path || r."type"
        FROM "Relationship" r
        JOIN relationship_path rp ON r."fromPersonId" = rp."toPersonId"
        WHERE r."familyGroupId" = ${familyGroupId}
          AND NOT (r."toPersonId" = ANY(rp.path))
          AND rp.depth < ${maxDepth}
      )
      SELECT depth, type_path FROM relationship_path
      WHERE "toPersonId" = ${toPersonId}
      ORDER BY depth
      LIMIT 1
    `;

    if (rows.length === 0) {
      return { path: null, description: "No relationship path found within 4 hops." };
    }

    return { path: rows[0].type_path, description: describeRelationshipPath(rows[0].type_path) };
  }
});

export const get_upcoming_birthdays = tool<GetUpcomingBirthdaysInput, BirthdayResult>({
  description: "Return family members with birthdays within a given number of days.",
  inputSchema: GetUpcomingBirthdaysSchema,
  execute: async ({ familyGroupId, withinDays }) => {
    const members = await db.familyMember.findMany({
      where: {
        familyGroupId,
        person: { ageGateLevel: { not: "MINOR" }, dateOfBirth: { not: null } }
      },
      include: { person: true }
    });

    const now = new Date();
    return members
      .map(m => {
        const dob = m.person.dateOfBirth as Date;
        const next = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
        if (next < now) next.setFullYear(now.getFullYear() + 1);
        const daysUntil = Math.floor((next.getTime() - now.getTime()) / 86_400_000);
        return { name: buildDisplayName(m.person), date: dob.toISOString().split("T")[0], daysUntil };
      })
      .filter(b => b.daysUntil <= withinDays)
      .sort((a, b) => a.daysUntil - b.daysUntil);
  }
});

export const get_upcoming_events = tool<GetUpcomingEventsInput, EventSummary[]>({
  description: "List upcoming events on the family calendar.",
  inputSchema: GetUpcomingEventsSchema,
  execute: async ({ familyGroupId, withinDays = 30 }) => {
    const now = new Date();
    const end = new Date(now.getTime() + withinDays * 86_400_000);

    const events = await db.event.findMany({
      where: { familyGroupId, startAt: { gte: now, lte: end } },
      include: { rsvps: true },
      orderBy: { startAt: "asc" },
      take: 20
    });

    return events.map(e => {
      const counts = { yes: 0, no: 0, maybe: 0, pending: 0 };
      for (const r of e.rsvps) {
        if (r.status === "YES") counts.yes++;
        else if (r.status === "NO") counts.no++;
        else if (r.status === "MAYBE") counts.maybe++;
        else counts.pending++;
      }
      return {
        id: e.id,
        title: e.title,
        startTime: e.startAt.toISOString(),
        location: e.locationName ?? null,
        rsvpSummary: counts
      };
    });
  }
});

export const get_event_details = tool<GetEventDetailsInput, EventDetailsResult>({
  description: "Return full details for a specific event including all RSVPs with person names.",
  inputSchema: GetEventDetailsSchema,
  execute: async ({ eventId, familyGroupId }) => {
    const event = await db.event.findFirst({
      where: { id: eventId, familyGroupId },
      include: { rsvps: true }
    });

    if (!event) return null;

    // RSVP has no direct person relation — fetch persons separately
    const personIds = event.rsvps.map(r => r.personId);
    const persons = await db.person.findMany({
      where: { id: { in: personIds } },
      select: { id: true, firstName: true, lastName: true, preferredName: true }
    });
    const personMap = new Map(persons.map(p => [p.id, p]));

    return {
      id: event.id,
      title: event.title,
      description: event.description ?? null,
      startTime: event.startAt.toISOString(),
      endTime: event.endAt?.toISOString() ?? null,
      location: event.locationName ?? null,
      rsvps: event.rsvps.map(r => {
        const p = personMap.get(r.personId);
        return { status: r.status, personName: p ? buildDisplayName(p) : r.personId };
      })
    };
  }
});

export const get_rsvp_status = tool<GetRsvpStatusInput, RsvpStatusResult>({
  description: "Return attendance breakdown for an event with person names in each status group.",
  inputSchema: GetRsvpStatusSchema,
  execute: async ({ eventId, familyGroupId }) => {
    const event = await db.event.findFirst({
      where: { id: eventId, familyGroupId },
      include: { rsvps: true }
    });

    if (!event) return null;

    const personIds = event.rsvps.map(r => r.personId);
    const persons = await db.person.findMany({
      where: { id: { in: personIds } },
      select: { id: true, firstName: true, lastName: true, preferredName: true }
    });
    const personMap = new Map(persons.map(p => [p.id, p]));

    const groups: RsvpStatusResult = { yes: [], no: [], maybe: [], pending: [] };
    for (const r of event.rsvps) {
      const p = personMap.get(r.personId);
      const name = p ? buildDisplayName(p) : r.personId;
      if (r.status === "YES") groups!.yes.push(name);
      else if (r.status === "NO") groups!.no.push(name);
      else if (r.status === "MAYBE") groups!.maybe.push(name);
      else groups!.pending.push(name);
    }

    return groups;
  }
});

export const get_household_members = tool<GetHouseholdMembersInput, PersonSummary[]>({
  description: "List non-minor members of a specific household within a family group.",
  inputSchema: GetHouseholdMembersSchema,
  execute: async ({ householdId, familyGroupId }) => {
    const household = await db.household.findFirst({ where: { id: householdId, familyGroupId } });
    if (!household) return [];

    const members = await db.householdMember.findMany({
      where: { householdId, person: { ageGateLevel: { not: "MINOR" } } },
      include: { person: true }
    });
    return members.map(m => toPersonSummary(m.person));
  }
});

export const get_contact_info = tool<GetContactInfoInput, ContactInfoResult>({
  description: "Return contact information for a non-minor person in the family group.",
  inputSchema: GetContactInfoSchema,
  execute: async ({ personId, familyGroupId }) => {
    const membership = await db.familyMember.findFirst({
      where: { personId, familyGroupId },
      include: { person: true }
    });

    if (!membership) return null;
    if (membership.person.ageGateLevel === "MINOR") return null;

    return {
      displayName: buildDisplayName(membership.person),
      email: membership.person.email ?? null,
      phone: membership.person.phone ?? null
    };
  }
});

export const create_event = tool<CreateEventInput, CreateEventResult>({
  description:
    "Draft a new event proposal. Does NOT create the event — returns a proposal for user confirmation. " +
    "The frontend must call POST /api/v1/events after the user confirms.",
  inputSchema: CreateEventSchema,
  execute: async ({ title, startTime, endTime, location, description, familyGroupId }) => {
    // GUARDRAIL: intentionally never calls db.event.create or any write.
    return {
      proposed: true,
      event: {
        title,
        startTime,
        endTime: endTime ?? null,
        location: location ?? null,
        description: description ?? null,
        familyGroupId
      },
      confirmationRequired: true,
      message: "I've drafted this event. Please confirm to create it."
    };
  }
});

/** All 10 tools bundled for use in streamText(). */
export const allTools = {
  get_person,
  get_family_members,
  get_relationship_path,
  get_upcoming_birthdays,
  get_upcoming_events,
  get_event_details,
  get_rsvp_status,
  get_household_members,
  get_contact_info,
  create_event
};
