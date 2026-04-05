import { Router, type Request } from "express";
import { z } from "zod";
import { db, type Event, type Person } from "@famlink/db";
import { birthdayMonthDayInYear, generateBirthdayEvents, type SyntheticBirthdayEvent } from "../lib/birthdayGenerator";
import { ERROR_PERSON_RECORD_REQUIRED } from "../lib/personRequiredMessages";
import type { AuthedRequest } from "../middleware/requireAuth";

const familyIdParam = z.object({
  familyId: z.string().min(1)
});

const monthQuery = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Expected YYYY-MM")
});

const upcomingQuery = z.object({
  days: z.coerce.number().int().min(1).optional()
});

function authed(req: Request): AuthedRequest {
  return req as unknown as AuthedRequest;
}

async function personForClerkUserId(clerkUserId: string) {
  return db.person.findUnique({ where: { userId: clerkUserId } });
}

async function requireFamilyMember(familyId: string, requesterPersonId: string) {
  const m = await db.familyMember.findUnique({
    where: { familyGroupId_personId: { familyGroupId: familyId, personId: requesterPersonId } }
  });
  return m !== null;
}

function serializeDbEvent(e: Event) {
  return {
    id: e.id,
    familyGroupId: e.familyGroupId,
    createdByPersonId: e.createdByPersonId,
    title: e.title,
    description: e.description,
    startAt: e.startAt.toISOString(),
    endAt: e.endAt?.toISOString() ?? null,
    locationName: e.locationName,
    locationAddress: e.locationAddress,
    locationMapUrl: e.locationMapUrl,
    visibility: e.visibility,
    isRecurring: e.isRecurring,
    recurrenceRule: e.recurrenceRule,
    isBirthdayEvent: e.isBirthdayEvent,
    birthdayPersonId: e.birthdayPersonId,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString()
  };
}

function dobString(p: Person): string | null {
  return p.dateOfBirth ? p.dateOfBirth.toISOString().slice(0, 10) : null;
}

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

/** Next birthday on or after `fromUtc` (date compared at UTC midnight). */
function nextBirthdayOnOrAfter(dobYmd: string, fromUtc: Date): Date {
  const fromM = utcMidnight(fromUtc);
  let y = fromM.getUTCFullYear();
  for (let i = 0; i < 400; i++) {
    const md = birthdayMonthDayInYear(dobYmd, y);
    if (!md) {
      return fromM;
    }
    const cand = new Date(Date.UTC(y, md.month - 1, md.day, 0, 0, 0, 0));
    if (cand.getTime() >= fromM.getTime()) {
      return cand;
    }
    y += 1;
  }
  return fromM;
}

function daysBetweenUtc(from: Date, to: Date): number {
  const a = utcMidnight(from).getTime();
  const b = utcMidnight(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

type CalendarRow = ReturnType<typeof serializeDbEvent> | SyntheticBirthdayEvent;

function byStartAt(a: { startAt: string }, b: { startAt: string }): number {
  return a.startAt.localeCompare(b.startAt);
}

export const calendarRouter = Router();

calendarRouter.get("/:familyId/calendar/upcoming", async (req, res) => {
  const p = familyIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid family id", details: p.error.flatten() });
    return;
  }
  const { familyId } = p.data;

  const q = upcomingQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: "Invalid query", details: q.error.flatten() });
    return;
  }
  const rawDays = q.data.days ?? 30;
  const days = Math.min(90, Math.max(1, rawDays));

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
    return;
  }
  if (!(await requireFamilyMember(familyId, requester.id))) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + days * 86_400_000);

  const members = await db.familyMember.findMany({
    where: { familyGroupId: familyId },
    include: { person: true }
  });
  const personsPayload = members.map((m) => ({
    id: m.person.id,
    firstName: m.person.firstName,
    lastName: m.person.lastName,
    dateOfBirth: dobString(m.person)
  }));

  const dbEvents = await db.event.findMany({
    where: {
      familyGroupId: familyId,
      startAt: { gte: now, lte: windowEnd }
    },
    orderBy: { startAt: "asc" }
  });

  const minY = now.getUTCFullYear();
  const maxY = windowEnd.getUTCFullYear();
  const synthetic: SyntheticBirthdayEvent[] = [];
  for (let y = minY; y <= maxY; y++) {
    synthetic.push(...generateBirthdayEvents(personsPayload, y, familyId));
  }
  const syntheticInWindow = synthetic.filter((e) => {
    const t = new Date(e.startAt).getTime();
    return t >= now.getTime() && t <= windowEnd.getTime();
  });

  const merged = new Map<string, CalendarRow>();
  for (const e of dbEvents.map(serializeDbEvent)) {
    merged.set(e.id, e);
  }
  for (const e of syntheticInWindow) {
    merged.set(e.id, e);
  }

  const events = [...merged.values()].sort(byStartAt);

  res.json({
    events,
    generatedAt: new Date().toISOString()
  });
});

calendarRouter.get("/:familyId/calendar/birthdays", async (req, res) => {
  const p = familyIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid family id", details: p.error.flatten() });
    return;
  }
  const { familyId } = p.data;

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
    return;
  }
  if (!(await requireFamilyMember(familyId, requester.id))) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }

  const members = await db.familyMember.findMany({
    where: { familyGroupId: familyId },
    include: { person: true }
  });

  const todayUtc = utcMidnight(new Date());
  const rows: Array<{
    person: ReturnType<typeof serializePersonBrief>;
    nextBirthday: string;
    daysUntilBirthday: number;
  }> = [];

  for (const m of members) {
    const dob = dobString(m.person);
    if (!dob) {
      continue;
    }
    const next = nextBirthdayOnOrAfter(dob, todayUtc);
    const daysUntilBirthday = daysBetweenUtc(todayUtc, next);
    rows.push({
      person: serializePersonBrief(m.person),
      nextBirthday: next.toISOString(),
      daysUntilBirthday
    });
  }

  rows.sort((a, b) => a.daysUntilBirthday - b.daysUntilBirthday);

  res.json({ birthdays: rows });
});

function serializePersonBrief(p: Person) {
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    preferredName: p.preferredName,
    dateOfBirth: p.dateOfBirth ? p.dateOfBirth.toISOString().slice(0, 10) : null,
    ageGateLevel: p.ageGateLevel
  };
}

calendarRouter.get("/:familyId/calendar", async (req, res) => {
  const p = familyIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid family id", details: p.error.flatten() });
    return;
  }
  const { familyId } = p.data;

  const q = monthQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: "Invalid query", details: q.error.flatten() });
    return;
  }
  const monthStr = q.data.month;
  const [ys, ms] = monthStr.split("-").map(Number);
  const monthIndex = ms - 1;
  if (ms < 1 || ms > 12) {
    res.status(400).json({ error: "Invalid query", details: { month: ["Month must be 01–12"] } });
    return;
  }

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
    return;
  }
  if (!(await requireFamilyMember(familyId, requester.id))) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }

  const startOfMonth = new Date(Date.UTC(ys, monthIndex, 1, 0, 0, 0, 0));
  const endOfMonthExclusive = new Date(Date.UTC(ys, monthIndex + 1, 1, 0, 0, 0, 0));

  const members = await db.familyMember.findMany({
    where: { familyGroupId: familyId },
    include: { person: true }
  });
  const personsPayload = members.map((m) => ({
    id: m.person.id,
    firstName: m.person.firstName,
    lastName: m.person.lastName,
    dateOfBirth: dobString(m.person)
  }));

  const dbEvents = await db.event.findMany({
    where: {
      familyGroupId: familyId,
      startAt: { gte: startOfMonth, lt: endOfMonthExclusive }
    },
    orderBy: { startAt: "asc" }
  });

  const year = ys;
  const allBirthdaysThisYear = generateBirthdayEvents(personsPayload, year, familyId);
  const birthdaysThisMonth = allBirthdaysThisYear.filter((b) => {
    const d = new Date(b.startAt);
    return d.getUTCFullYear() === ys && d.getUTCMonth() === monthIndex;
  });

  const combined: CalendarRow[] = [
    ...dbEvents.map(serializeDbEvent),
    ...birthdaysThisMonth
  ].sort(byStartAt);

  res.json({
    month: monthStr,
    events: combined
  });
});
