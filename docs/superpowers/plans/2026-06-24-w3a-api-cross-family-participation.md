# W3a-API — Cross-Family Event Participation (backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend for cross-family event participation — an `EventParticipant` grant lets an existing FamLink user from another family RSVP and contribute tasks to one event, with hard tenant isolation everywhere else.

**Architecture:** A new `EventParticipant` model is the canonical access grant. A single resolver (`resolveEventAccess`) unifies "owning-family member" and "cross-family participant" into one capability object that every event route consults. View-access plugs into the existing `eventVisibility` filter; a `ForeignInvitedEventDTO` shapes reads for foreign participants; notifications are computed from the participant set. Companion UI ships in the separate **W3a-UI** plan.

**Tech Stack:** TypeScript, Express, Prisma (`@famlink/db`), Vitest + supertest, Twilio/Resend/FCM via `NotificationService`.

**Spec:** `docs/superpowers/specs/2026-06-24-w3a-cross-family-event-participation-design.md`

## Global Constraints

- **Test runner:** Vitest from `apps/api` (`npx vitest run <path>`). Route tests use supertest with mocked auth; lib tests are DB-backed against local Postgres `famlink_test`.
- **Commit format:** `feat: P3-03 <short description>` (W3 = phase P3-03).
- **Access is conferred ONLY by an `ACTIVE EventParticipant` grant** — never an invitation row, family membership of another tenant, contact match, or shared-`Person` record.
- **Grants are snapshots** — adding a member to a participant's family never creates a grant.
- **No entitlement transfer** — participation grants event-scoped access only; never AI/premium.
- **Isolation (P3-00/reframe §8):** a cross-family participant must never receive family name, member roster beyond participants, other events, non-participant attendees, internal IDs not required by the surface, or unrelated invitations.
- **Roles:** `EventRole { PARTICIPANT, EVENT_ADMIN }`. **Status:** `ParticipantStatus { ACTIVE, REVOKED }`.
- **W3a contribution surface = RSVP + tasks (`EventItem`) only.** Cross-family photo/registry writes are out of scope (rejected). Owning-family members keep all existing surfaces.
- **Accept = authenticated, any channel** (one-tap link). SMS "reply Y" is W3b, not here.

---

## File Structure

- **Modify** `packages/db/prisma/schema.prisma` — add `EventParticipant` model, `EventRole`/`ParticipantStatus` enums, `EventInvitation.role`, `Event.participants` relation. New migration.
- **Create** `apps/api/src/lib/eventAccess.ts` — `activeEventParticipant` + `resolveEventAccess` (the unified capability resolver) + `ForeignInvitedEventDTO` serializer.
- **Create** `apps/api/src/lib/__tests__/eventAccess.test.ts`.
- **Modify** `apps/api/src/lib/eventVisibility.ts` — add active-participant clause to `invitedOrParticipantFilter`.
- **Modify** `apps/api/src/routes/events.ts` — cross-family invite kind; accept/decline/revoke/set-role endpoints; participant-aware RSVP; per-item task endpoints; foreign-DTO detail read.
- **Modify** `apps/api/src/routes/__tests__/events.test.ts` — route tests.
- **Modify** `apps/api/src/lib/notificationService.ts` (or a small helper) — participant-scoped recipient calc for event notifications.

---

### Task 1: Schema — `EventParticipant`, enums, invitation role, migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Migration: `packages/db/prisma/migrations/<timestamp>_event_participant/migration.sql` (generated)

**Interfaces:**
- Produces: `EventParticipant { id, eventId, personId, role: EventRole, status: ParticipantStatus, invitedById, createdAt, updatedAt }`, unique `(eventId, personId)`; enums `EventRole`, `ParticipantStatus`; `EventInvitation.role: EventRole?`; `Event.participants: EventParticipant[]`.

- [ ] **Step 1: Add the model + enums to `schema.prisma`**

After the `RSVP` model add:

```prisma
enum EventRole {
  PARTICIPANT
  EVENT_ADMIN
}

enum ParticipantStatus {
  ACTIVE
  REVOKED
}

model EventParticipant {
  id          String            @id @default(cuid())
  eventId     String
  event       Event             @relation(fields: [eventId], references: [id], onDelete: Cascade)
  personId    String
  person      Person            @relation(fields: [personId], references: [id], onDelete: Cascade)
  role        EventRole         @default(PARTICIPANT)
  status      ParticipantStatus @default(ACTIVE)
  invitedById String?
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  @@unique([eventId, personId])
  @@index([eventId])
  @@index([personId])
}
```

In `model Event`, add to the relations block: `participants EventParticipant[]`.
In `model EventInvitation`, add: `role EventRole?`.
In `model Person`, add to its relations: `eventParticipations EventParticipant[]`.

- [ ] **Step 2: Generate the migration + client**

Run: `cd packages/db && npx prisma migrate dev --name event_participant`
Expected: a new migration applied to `famlink_test`/dev; `prisma generate` runs. Verify the SQL creates `EventParticipant`, both enums, and the `EventInvitation.role` column.

- [ ] **Step 3: Smoke test the new model**

Create a minimal check in `apps/api/src/lib/__tests__/eventAccess.test.ts` (full suite added in Task 2) — for now just:

```typescript
import { db } from "@famlink/db";
import { describe, it, expect } from "vitest";

describe("EventParticipant schema", () => {
  it("enforces unique (eventId, personId)", async () => {
    // seed via helpers added in later tasks; placeholder smoke retained until Task 2 fills it
    expect(typeof db.eventParticipant.create).toBe("function");
  });
});
```

- [ ] **Step 4: Run it**

Run: `cd apps/api && npx vitest run src/lib/__tests__/eventAccess.test.ts`
Expected: PASS (client has `eventParticipant`).

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations apps/api/src/lib/__tests__/eventAccess.test.ts
git commit -m "feat: P3-03 EventParticipant model + roles + invitation role"
```

---

### Task 2: Access resolver (`eventAccess.ts`) — the unified capability gate

**Files:**
- Create: `apps/api/src/lib/eventAccess.ts`
- Test: `apps/api/src/lib/__tests__/eventAccess.test.ts` (replace the smoke test)

**Interfaces:**
- Consumes: `db`; `activeFamilyMembership`, `hasAdminRole` from `../lib/familyAccess`; `canViewEvent` from `./eventVisibility`.
- Produces:
  - `activeEventParticipant(personId, eventId): Promise<{ role: "PARTICIPANT" | "EVENT_ADMIN" } | null>` — the matching `ACTIVE` grant, else null.
  - `type EventAccess = { event: Event; isOwningMember: boolean; isOwningAdmin: boolean; eventRole: "PARTICIPANT" | "EVENT_ADMIN" | null; canView: boolean; canContribute: boolean; canAdmin: boolean }`.
  - `resolveEventAccess(eventId, personId): Promise<EventAccess | { error: "not_found" }>` — loads the event; computes owning-family membership (via `activeFamilyMembership`) and the cross-family grant; `canAdmin = isOwningAdmin || creator || eventRole==="EVENT_ADMIN"`; `canContribute = isOwningMember || eventRole !== null`; `canView` honors `canViewEvent` for owning members and `eventRole !== null` for participants. Returns `{ error: "not_found" }` when the event doesn't exist OR the requester has no access at all (full-hiding parity).

- [ ] **Step 1: Write the failing tests**

Replace `eventAccess.test.ts` with DB-backed tests (reuse existing helpers `seedTestPerson`, `seedTestFamily`; add a helper to create an event + a participant):

```typescript
import { db } from "@famlink/db";
import { describe, it, expect } from "vitest";
import { seedTestPerson, seedTestFamily } from "../../__tests__/helpers/db";
import { activeEventParticipant, resolveEventAccess } from "../eventAccess";

async function seedEvent(familyGroupId: string, createdByPersonId: string) {
  return db.event.create({
    data: { familyGroupId, createdByPersonId, title: "E", startAt: new Date(), eventVisibility: "PRIVATE" }
  });
}

describe("activeEventParticipant", () => {
  it("returns null when there is no grant", async () => {
    const a = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(a.id);
    const ev = await seedEvent(familyGroup.id, a.id);
    const outsider = await seedTestPerson();
    expect(await activeEventParticipant(outsider.id, ev.id)).toBeNull();
  });

  it("returns the role for an ACTIVE grant and null for REVOKED", async () => {
    const a = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(a.id);
    const ev = await seedEvent(familyGroup.id, a.id);
    const p = await seedTestPerson();
    const grant = await db.eventParticipant.create({ data: { eventId: ev.id, personId: p.id, role: "EVENT_ADMIN", status: "ACTIVE" } });
    expect(await activeEventParticipant(p.id, ev.id)).toEqual({ role: "EVENT_ADMIN" });
    await db.eventParticipant.update({ where: { id: grant.id }, data: { status: "REVOKED" } });
    expect(await activeEventParticipant(p.id, ev.id)).toBeNull();
  });
});

describe("resolveEventAccess", () => {
  it("owning-family creator: canView/contribute/admin true", async () => {
    const a = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(a.id);
    const ev = await seedEvent(familyGroup.id, a.id);
    const acc = await resolveEventAccess(ev.id, a.id);
    expect(acc).toMatchObject({ isOwningMember: true, canView: true, canContribute: true, canAdmin: true });
  });

  it("cross-family PARTICIPANT: view+contribute, not admin", async () => {
    const a = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(a.id);
    const ev = await seedEvent(familyGroup.id, a.id);
    const p = await seedTestPerson();
    await db.eventParticipant.create({ data: { eventId: ev.id, personId: p.id, role: "PARTICIPANT", status: "ACTIVE" } });
    const acc = await resolveEventAccess(ev.id, p.id);
    expect(acc).toMatchObject({ isOwningMember: false, eventRole: "PARTICIPANT", canView: true, canContribute: true, canAdmin: false });
  });

  it("cross-family EVENT_ADMIN: canAdmin true", async () => {
    const a = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(a.id);
    const ev = await seedEvent(familyGroup.id, a.id);
    const p = await seedTestPerson();
    await db.eventParticipant.create({ data: { eventId: ev.id, personId: p.id, role: "EVENT_ADMIN", status: "ACTIVE" } });
    const acc = await resolveEventAccess(ev.id, p.id);
    expect(acc).toMatchObject({ eventRole: "EVENT_ADMIN", canAdmin: true });
  });

  it("no access at all -> not_found (full hiding)", async () => {
    const a = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(a.id);
    const ev = await seedEvent(familyGroup.id, a.id);
    const outsider = await seedTestPerson();
    expect(await resolveEventAccess(ev.id, outsider.id)).toEqual({ error: "not_found" });
  });

  it("missing event -> not_found", async () => {
    const outsider = await seedTestPerson();
    expect(await resolveEventAccess("nope", outsider.id)).toEqual({ error: "not_found" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/lib/__tests__/eventAccess.test.ts`
Expected: FAIL — `../eventAccess` exports missing.

- [ ] **Step 3: Implement `eventAccess.ts`**

```typescript
import { db } from "@famlink/db";
import type { Event } from "@famlink/db";
import { activeFamilyMembership, hasAdminRole } from "./familyAccess";
import { canViewEvent } from "./eventVisibility";

export async function activeEventParticipant(
  personId: string,
  eventId: string
): Promise<{ role: "PARTICIPANT" | "EVENT_ADMIN" } | null> {
  const grant = await db.eventParticipant.findUnique({
    where: { eventId_personId: { eventId, personId } },
    select: { role: true, status: true }
  });
  if (!grant || grant.status !== "ACTIVE") return null;
  return { role: grant.role };
}

export type EventAccess = {
  event: Event;
  isOwningMember: boolean;
  isOwningAdmin: boolean;
  eventRole: "PARTICIPANT" | "EVENT_ADMIN" | null;
  canView: boolean;
  canContribute: boolean;
  canAdmin: boolean;
};

export async function resolveEventAccess(
  eventId: string,
  personId: string
): Promise<EventAccess | { error: "not_found" }> {
  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) return { error: "not_found" };

  const membership = await activeFamilyMembership(event.familyGroupId, personId);
  const isOwningMember = membership !== null;
  const isOwningAdmin = membership ? hasAdminRole(membership) : false;
  const grant = await activeEventParticipant(personId, eventId);
  const eventRole = grant?.role ?? null;

  const memberCanView = isOwningMember
    ? await canViewEvent(event, personId, isOwningAdmin)
    : false;
  const canView = memberCanView || eventRole !== null;
  if (!canView) return { error: "not_found" };

  const isCreator = event.createdByPersonId === personId;
  return {
    event,
    isOwningMember,
    isOwningAdmin,
    eventRole,
    canView: true,
    canContribute: isOwningMember || eventRole !== null,
    canAdmin: isOwningAdmin || isCreator || eventRole === "EVENT_ADMIN"
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && npx vitest run src/lib/__tests__/eventAccess.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/eventAccess.ts apps/api/src/lib/__tests__/eventAccess.test.ts
git commit -m "feat: P3-03 unified event access resolver (member + participant grant)"
```

---

### Task 3: View-access — participants in `eventVisibility`

**Files:**
- Modify: `apps/api/src/lib/eventVisibility.ts`
- Test: `apps/api/src/lib/__tests__/eventVisibility.test.ts` (existing; add a case)

**Interfaces:** extends `invitedOrParticipantFilter` so an `ACTIVE EventParticipant` makes a PRIVATE event visible in list/detail filters (parity with the RSVP/invitation clauses).

- [ ] **Step 1: Write the failing test**

Add to the existing `eventVisibility.test.ts` (follow its existing seeding pattern; if none, mirror `eventAccess.test.ts` helpers):

```typescript
it("an ACTIVE event participant can view a PRIVATE event", async () => {
  const owner = await seedTestPerson();
  const { familyGroup } = await seedTestFamily(owner.id);
  const ev = await db.event.create({ data: { familyGroupId: familyGroup.id, createdByPersonId: owner.id, title: "P", startAt: new Date(), eventVisibility: "PRIVATE" } });
  const p = await seedTestPerson();
  await db.eventParticipant.create({ data: { eventId: ev.id, personId: p.id, status: "ACTIVE" } });
  expect(await canViewEvent(ev, p.id, false)).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/lib/__tests__/eventVisibility.test.ts`
Expected: FAIL — participant not yet in the filter.

- [ ] **Step 3: Implement**

In `eventVisibility.ts`, add a clause to the array returned by `invitedOrParticipantFilter`:

```typescript
    { participants: { some: { personId, status: "ACTIVE" } } },
```

(placed alongside the `rsvps`/`invitations` clauses).

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && npx vitest run src/lib/__tests__/eventVisibility.test.ts`
Expected: PASS (existing cases + new).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/eventVisibility.ts apps/api/src/lib/__tests__/eventVisibility.test.ts
git commit -m "feat: P3-03 active participants can view their event"
```

---

### Task 4: Cross-family invite (extend `POST /:eventId/invitations`)

**Files:**
- Modify: `apps/api/src/routes/events.ts`
- Test: `apps/api/src/routes/__tests__/events.test.ts`

**Interfaces:**
- Adds a new invitee kind `"famlinkUser"` to `SendInvitationsV2Schema`: `{ kind: "famlinkUser", personId: string, role?: "PARTICIPANT" | "EVENT_ADMIN" }`. Creates an `EventInvitation` with `linkedPersonId = personId`, `role = role ?? "PARTICIPANT"`, `guestToken` (for the accept link), `status = "PENDING"`. Authz: only `resolveEventAccess(...).canAdmin` may invite cross-family. Sends a notification with an accept link.

- [ ] **Step 1: Write the failing tests**

In `events.test.ts`, add to the `POST /:eventId/invitations` describe:

```typescript
it("event-admin can invite a cross-family FamLink user (creates PENDING invite w/ linkedPersonId + role)", async () => {
  // arrange: requester is creator/owning-admin of a PRIVATE event; target is a person in another family
  // (use the file's existing event + person seeding helpers / mocks)
  const res = await request(app).post(`/api/v1/events/${eventId}/invitations`)
    .send({ invitees: [{ kind: "famlinkUser", personId: targetPersonId, role: "PARTICIPANT" }] });
  expect(res.status).toBe(201);
  const inv = await db.eventInvitation.findFirst({ where: { eventId, linkedPersonId: targetPersonId } });
  expect(inv?.role).toBe("PARTICIPANT");
  expect(inv?.guestToken).toBeTruthy();
});

it("a non-admin participant cannot invite cross-family users", async () => {
  // arrange: requester has only PARTICIPANT grant (canAdmin false)
  const res = await request(app).post(`/api/v1/events/${eventId}/invitations`)
    .send({ invitees: [{ kind: "famlinkUser", personId: someoneId }] });
  expect(res.status).toBe(403);
});
```

> Follow the existing test file's auth-mock + seeding conventions; the assertions above are the contract.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/routes/__tests__/events.test.ts`
Expected: FAIL — `famlinkUser` kind unrecognized / not authorized via grant.

- [ ] **Step 3: Implement**

In `events.ts`:
1. Extend `SendInvitationsV2Schema`'s invitee union with `z.object({ kind: z.literal("famlinkUser"), personId: z.string().min(1), role: z.enum(["PARTICIPANT", "EVENT_ADMIN"]).optional() })`.
2. Replace the invite-authz block (currently membership + PRIVATE-admin check at ~lines 506-516) so cross-family invites require admin via the resolver. Keep existing member-invite behavior:

```typescript
  const access = await resolveEventAccess(eventId, requester.id);
  if ("error" in access) { res.status(404).json({ error: "Event not found" }); return; }
  // existing member/guest invites: keep prior rule (organizer/admin for PRIVATE; any member for OPEN)
  const hasFamlinkUserInvite = parsed.data.invitees.some((i) => i.kind === "famlinkUser");
  if (hasFamlinkUserInvite && !access.canAdmin) {
    res.status(403).json({ error: "Only an event admin can invite cross-family participants" });
    return;
  }
  if (!access.isOwningMember && !access.canAdmin) {
    res.status(403).json({ error: "Not authorized to invite to this event" });
    return;
  }
```

3. In the `$transaction` loop, handle the new kind:

```typescript
      } else if (invitee.kind === "famlinkUser") {
        const existing = await tx.eventInvitation.findFirst({ where: { eventId, linkedPersonId: invitee.personId } });
        if (!existing) {
          const created = await tx.eventInvitation.create({
            data: {
              eventId,
              linkedPersonId: invitee.personId,
              role: invitee.role ?? "PARTICIPANT",
              guestToken: generateInviteToken(),
              invitedById: requester.id,
              scope: "INDIVIDUAL",
              status: "PENDING",
              sentAt: now
            }
          });
          createdInvitations.push(created);
        }
      }
```

4. After the transaction, send a notification to each cross-family invitee with an accept link (`${env.WEB_APP_URL}/events/accept?token=<guestToken>`) via `NotificationService` (`EVENT_INVITE`). Keep it fire-and-forget like the existing invite paths; non-fatal on error.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && npx vitest run src/routes/__tests__/events.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/events.ts apps/api/src/routes/__tests__/events.test.ts
git commit -m "feat: P3-03 invite cross-family FamLink users to an event"
```

---

### Task 5: Accept / decline endpoints

**Files:**
- Modify: `apps/api/src/routes/events.ts`
- Test: `apps/api/src/routes/__tests__/events.test.ts`

**Interfaces:**
- `POST /api/v1/events/:eventId/participation/accept` body `{ token: string }` — the authenticated requester accepts a PENDING invitation whose `linkedPersonId === requester.id` AND `guestToken === token`. Creates/updates `EventParticipant(status=ACTIVE, role=invitation.role ?? "PARTICIPANT")`, sets invitation `status="ACCEPTED"`. Binds to authenticated identity (a token alone, without the matching account, cannot accept).
- `POST /api/v1/events/:eventId/participation/decline` body `{ token }` — sets invitation `status="DECLINED"`; no grant.

- [ ] **Step 1: Write the failing tests**

```typescript
it("accept: authenticated invitee with matching token gets an ACTIVE grant", async () => {
  // arrange: PENDING invitation { eventId, linkedPersonId: requester.id, role: "EVENT_ADMIN", guestToken: T }
  const res = await request(app).post(`/api/v1/events/${eventId}/participation/accept`).send({ token: T });
  expect(res.status).toBe(200);
  const g = await db.eventParticipant.findUnique({ where: { eventId_personId: { eventId, personId: requesterId } } });
  expect(g).toMatchObject({ status: "ACTIVE", role: "EVENT_ADMIN" });
});

it("accept: token that doesn't belong to the requester is rejected (no grant)", async () => {
  // invitation.linkedPersonId is someone else
  const res = await request(app).post(`/api/v1/events/${eventId}/participation/accept`).send({ token: T });
  expect(res.status).toBe(403);
  expect(await db.eventParticipant.findFirst({ where: { eventId, personId: requesterId } })).toBeNull();
});

it("decline: marks the invitation DECLINED and creates no grant", async () => {
  const res = await request(app).post(`/api/v1/events/${eventId}/participation/decline`).send({ token: T });
  expect(res.status).toBe(200);
  expect(await db.eventParticipant.findFirst({ where: { eventId, personId: requesterId } })).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/routes/__tests__/events.test.ts`
Expected: FAIL — endpoints missing.

- [ ] **Step 3: Implement** (add to `events.ts`)

```typescript
const ParticipationTokenSchema = z.object({ token: z.string().min(1) });

eventsRouter.post("/:eventId/participation/accept", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid event id" }); return; }
  const body = ParticipationTokenSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid request body" }); return; }
  const requester = personed(req).person;

  const inv = await db.eventInvitation.findFirst({
    where: { eventId: p.data.eventId, guestToken: body.data.token, status: "PENDING" }
  });
  // Bind to authenticated identity: the token's invitation must target THIS person.
  if (!inv || inv.linkedPersonId !== requester.id) {
    res.status(403).json({ error: "This invitation is not for your account" });
    return;
  }
  await db.$transaction(async (tx) => {
    await tx.eventParticipant.upsert({
      where: { eventId_personId: { eventId: p.data.eventId, personId: requester.id } },
      create: { eventId: p.data.eventId, personId: requester.id, role: inv.role ?? "PARTICIPANT", status: "ACTIVE", invitedById: inv.invitedById ?? null },
      update: { status: "ACTIVE", role: inv.role ?? "PARTICIPANT" }
    });
    await tx.eventInvitation.update({ where: { id: inv.id }, data: { status: "ACCEPTED" } });
  });
  res.json({ accepted: true });
});

eventsRouter.post("/:eventId/participation/decline", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: "Invalid event id" }); return; }
  const body = ParticipationTokenSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid request body" }); return; }
  const requester = personed(req).person;

  const inv = await db.eventInvitation.findFirst({
    where: { eventId: p.data.eventId, guestToken: body.data.token, status: "PENDING" }
  });
  if (!inv || inv.linkedPersonId !== requester.id) {
    res.status(403).json({ error: "This invitation is not for your account" });
    return;
  }
  await db.eventInvitation.update({ where: { id: inv.id }, data: { status: "DECLINED" } });
  res.json({ declined: true });
});
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && npx vitest run src/routes/__tests__/events.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/events.ts apps/api/src/routes/__tests__/events.test.ts
git commit -m "feat: P3-03 accept/decline cross-family event participation"
```

---

### Task 6: Revoke + set-role (event-admin only)

**Files:**
- Modify: `apps/api/src/routes/events.ts`
- Test: `apps/api/src/routes/__tests__/events.test.ts`

**Interfaces:**
- `POST /api/v1/events/:eventId/participants/:personId/revoke` — `canAdmin` only; sets that grant `status="REVOKED"`. Access is cut immediately (the resolver only honors ACTIVE).
- `PUT /api/v1/events/:eventId/participants/:personId/role` body `{ role: "PARTICIPANT" | "EVENT_ADMIN" }` — `canAdmin` only; updates an ACTIVE grant's role.

- [ ] **Step 1: Write the failing tests**

```typescript
it("event-admin revoke sets status REVOKED and cuts access", async () => {
  const res = await request(app).post(`/api/v1/events/${eventId}/participants/${targetId}/revoke`).send();
  expect(res.status).toBe(200);
  expect(await activeEventParticipant(targetId, eventId)).toBeNull();
});

it("a participant (non-admin) cannot revoke others", async () => {
  const res = await request(app).post(`/api/v1/events/${eventId}/participants/${targetId}/revoke`).send();
  expect(res.status).toBe(403);
});

it("event-admin can promote a participant to EVENT_ADMIN", async () => {
  const res = await request(app).put(`/api/v1/events/${eventId}/participants/${targetId}/role`).send({ role: "EVENT_ADMIN" });
  expect(res.status).toBe(200);
  expect(await activeEventParticipant(targetId, eventId)).toEqual({ role: "EVENT_ADMIN" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/routes/__tests__/events.test.ts`
Expected: FAIL — endpoints missing.

- [ ] **Step 3: Implement** (add to `events.ts`)

```typescript
const SetRoleSchema = z.object({ role: z.enum(["PARTICIPANT", "EVENT_ADMIN"]) });

eventsRouter.post("/:eventId/participants/:personId/revoke", async (req, res) => {
  const requester = personed(req).person;
  const access = await resolveEventAccess(req.params.eventId, requester.id);
  if ("error" in access) { res.status(404).json({ error: "Event not found" }); return; }
  if (!access.canAdmin) { res.status(403).json({ error: "Only an event admin can revoke participants" }); return; }
  await db.eventParticipant.updateMany({
    where: { eventId: req.params.eventId, personId: req.params.personId },
    data: { status: "REVOKED" }
  });
  res.json({ revoked: true });
});

eventsRouter.put("/:eventId/participants/:personId/role", async (req, res) => {
  const body = SetRoleSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid role" }); return; }
  const requester = personed(req).person;
  const access = await resolveEventAccess(req.params.eventId, requester.id);
  if ("error" in access) { res.status(404).json({ error: "Event not found" }); return; }
  if (!access.canAdmin) { res.status(403).json({ error: "Only an event admin can set roles" }); return; }
  await db.eventParticipant.updateMany({
    where: { eventId: req.params.eventId, personId: req.params.personId, status: "ACTIVE" },
    data: { role: body.data.role }
  });
  res.json({ updated: true });
});
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && npx vitest run src/routes/__tests__/events.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/events.ts apps/api/src/routes/__tests__/events.test.ts
git commit -m "feat: P3-03 revoke + role management for event participants"
```

---

### Task 7: Participant-aware RSVP

**Files:**
- Modify: `apps/api/src/routes/events.ts` (the `PUT /:eventId/rsvp` handler)
- Test: `apps/api/src/routes/__tests__/events.test.ts`

**Interfaces:** RSVP authorization switches from `loadEventForMember` to `resolveEventAccess` so an active cross-family participant can RSVP. Owning-member behavior unchanged.

- [ ] **Step 1: Write the failing test**

```typescript
it("an active cross-family participant can RSVP", async () => {
  // arrange: requester has an ACTIVE PARTICIPANT grant but is NOT an owning member
  const res = await request(app).put(`/api/v1/events/${eventId}/rsvp`).send({ status: "YES" });
  expect(res.status).toBe(200);
  expect(await db.rSVP.findUnique({ where: { eventId_personId: { eventId, personId: requesterId } } })).toMatchObject({ status: "YES" });
});

it("a non-participant non-member cannot RSVP (404 full-hide)", async () => {
  const res = await request(app).put(`/api/v1/events/${eventId}/rsvp`).send({ status: "YES" });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/routes/__tests__/events.test.ts`
Expected: FAIL — participant gets 403/404 under the old member-only loader.

- [ ] **Step 3: Implement**

Replace the `loadEventForMember(...)` block in `PUT /:eventId/rsvp` (lines ~759-769) with:

```typescript
  const access = await resolveEventAccess(eventId, requester.id);
  if ("error" in access) { res.status(404).json({ error: "Event not found" }); return; }
  if (!access.canContribute) { res.status(403).json({ error: "Not authorized to RSVP to this event" }); return; }
  const { event } = access;
```

(The rest of the handler — the `rSVP.upsert` and organizer notify — is unchanged.)

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && npx vitest run src/routes/__tests__/events.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/events.ts apps/api/src/routes/__tests__/events.test.ts
git commit -m "feat: P3-03 allow active participants to RSVP"
```

---

### Task 8: Participant task contributions (per-item `EventItem` endpoints)

**Files:**
- Modify: `apps/api/src/routes/events.ts`
- Test: `apps/api/src/routes/__tests__/events.test.ts`

**Interfaces:** the existing `POST /:eventId/potluck` (bulk replace) stays creator/admin-only. Add per-item endpoints any contributor (member or participant) can use, with own-only edit/delete:
- `POST /api/v1/events/:eventId/items` body `{ name, quantity?, notes? }` → creates one `EventItem` with `createdByPersonId = requester`. Requires `canContribute`.
- `PATCH /api/v1/events/:eventId/items/:itemId` → edit; requires `canAdmin` OR item's `createdByPersonId === requester`.
- `DELETE /api/v1/events/:eventId/items/:itemId` → same authz as PATCH.

- [ ] **Step 1: Write the failing tests**

```typescript
it("a participant can add a task item (own contribution)", async () => {
  const res = await request(app).post(`/api/v1/events/${eventId}/items`).send({ name: "Cups" });
  expect(res.status).toBe(201);
  expect(res.body.createdByPersonId).toBe(requesterId);
});

it("a participant cannot edit another person's item", async () => {
  const res = await request(app).patch(`/api/v1/events/${eventId}/items/${othersItemId}`).send({ name: "x" });
  expect(res.status).toBe(403);
});

it("an event-admin can edit anyone's item", async () => {
  const res = await request(app).patch(`/api/v1/events/${eventId}/items/${othersItemId}`).send({ name: "x" });
  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/routes/__tests__/events.test.ts`
Expected: FAIL — endpoints missing.

- [ ] **Step 3: Implement** (add to `events.ts`)

```typescript
const CreateItemSchema = z.object({ name: z.string().min(1), quantity: z.string().optional(), notes: z.string().optional() });
const PatchItemSchema = z.object({ name: z.string().min(1).optional(), quantity: z.string().nullable().optional(), notes: z.string().nullable().optional(), status: z.string().optional() });

eventsRouter.post("/:eventId/items", async (req, res) => {
  const body = CreateItemSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid item", details: body.error.flatten() }); return; }
  const requester = personed(req).person;
  const access = await resolveEventAccess(req.params.eventId, requester.id);
  if ("error" in access) { res.status(404).json({ error: "Event not found" }); return; }
  if (!access.canContribute) { res.status(403).json({ error: "Not authorized to contribute to this event" }); return; }
  const created = await db.eventItem.create({
    data: { eventId: req.params.eventId, createdByPersonId: requester.id, name: body.data.name, quantity: body.data.quantity ?? null, notes: body.data.notes ?? null }
  });
  res.status(201).json(serializeEventItem(created));
});

async function authorizeItemMutation(eventId: string, itemId: string, personId: string) {
  const access = await resolveEventAccess(eventId, personId);
  if ("error" in access) return { error: "not_found" as const };
  const item = await db.eventItem.findFirst({ where: { id: itemId, eventId } });
  if (!item) return { error: "not_found" as const };
  if (!access.canAdmin && item.createdByPersonId !== personId) return { error: "forbidden" as const };
  return { item };
}

eventsRouter.patch("/:eventId/items/:itemId", async (req, res) => {
  const body = PatchItemSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid item", details: body.error.flatten() }); return; }
  const requester = personed(req).person;
  const r = await authorizeItemMutation(req.params.eventId, req.params.itemId, requester.id);
  if (r.error === "not_found") { res.status(404).json({ error: "Item not found" }); return; }
  if (r.error === "forbidden") { res.status(403).json({ error: "You can only edit your own contribution" }); return; }
  const updated = await db.eventItem.update({ where: { id: req.params.itemId }, data: body.data });
  res.json(serializeEventItem(updated));
});

eventsRouter.delete("/:eventId/items/:itemId", async (req, res) => {
  const requester = personed(req).person;
  const r = await authorizeItemMutation(req.params.eventId, req.params.itemId, requester.id);
  if (r.error === "not_found") { res.status(404).json({ error: "Item not found" }); return; }
  if (r.error === "forbidden") { res.status(403).json({ error: "You can only delete your own contribution" }); return; }
  await db.eventItem.delete({ where: { id: req.params.itemId } });
  res.status(204).end();
});
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && npx vitest run src/routes/__tests__/events.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/events.ts apps/api/src/routes/__tests__/events.test.ts
git commit -m "feat: P3-03 per-item task contributions with own-only edit/delete"
```

---

### Task 9: `ForeignInvitedEventDTO` — isolation-safe detail read

**Files:**
- Modify: `apps/api/src/lib/eventAccess.ts` (add the serializer)
- Modify: `apps/api/src/routes/events.ts` (the `GET /:eventId` handler)
- Test: `apps/api/src/routes/__tests__/events.test.ts`

**Interfaces:** `toForeignInvitedEventDTO(event, participants, items)` returns ONLY: `id, title, description, startAt, endAt, locationName, locationAddress, locationMapUrl, eventType`, a `participants: [{ displayName, rsvpStatus }]` list, and `tasks: [serializeEventItem]`. It MUST NOT include `familyGroupId`, family name, roster beyond participants, other events, or internal person/family/household IDs. `GET /:eventId` returns this DTO when the requester is a cross-family participant (`!isOwningMember && eventRole !== null`); owning members get the existing full `serializeEvent` shape.

- [ ] **Step 1: Write the failing tests**

```typescript
it("cross-family participant detail read omits family identifiers", async () => {
  // arrange: requester has ACTIVE grant, not an owning member
  const res = await request(app).get(`/api/v1/events/${eventId}`);
  expect(res.status).toBe(200);
  expect(res.body.familyGroupId).toBeUndefined();
  expect(res.body.title).toBeDefined();
  expect(Array.isArray(res.body.participants)).toBe(true);
  expect(res.body.participants[0]).toHaveProperty("displayName");
  expect(res.body.participants[0]).toHaveProperty("rsvpStatus");
  // no internal person ids leaked on the participant list
  expect(res.body.participants[0].personId).toBeUndefined();
});

it("owning member detail read still returns the full event shape", async () => {
  const res = await request(app).get(`/api/v1/events/${eventId}`);
  expect(res.body.familyGroupId).toBe(familyGroupId);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/routes/__tests__/events.test.ts`
Expected: FAIL — foreign read still returns full event / DTO missing.

- [ ] **Step 3: Implement**

In `eventAccess.ts`:

```typescript
export function toForeignInvitedEventDTO(
  event: Event,
  participants: Array<{ displayName: string; rsvpStatus: string | null }>,
  tasks: Array<Record<string, unknown>>
) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startAt: event.startAt.toISOString(),
    endAt: event.endAt?.toISOString() ?? null,
    locationName: event.locationName,
    locationAddress: event.locationAddress,
    locationMapUrl: event.locationMapUrl,
    eventType: event.eventType,
    participants,
    tasks
  };
}
```

In `GET /:eventId` (after access is resolved and the event loaded), branch before the existing member serialization:

```typescript
  if (!access.isOwningMember && access.eventRole !== null) {
    const grants = await db.eventParticipant.findMany({
      where: { eventId, status: "ACTIVE" },
      select: { person: { select: { firstName: true, preferredName: true } } }
    });
    const owningMembers = await db.familyMember.findMany({
      where: { familyGroupId: access.event.familyGroupId },
      select: { person: { select: { id: true, firstName: true, preferredName: true } } }
    });
    const rsvps = await db.rSVP.findMany({ where: { eventId }, select: { personId: true, status: true } });
    const rsvpByPerson = new Map(rsvps.map((r) => [r.personId, r.status]));
    const participantList = [
      ...owningMembers.map((m) => ({ displayName: m.person.preferredName ?? m.person.firstName, rsvpStatus: rsvpByPerson.get(m.person.id) ?? null })),
      ...grants.map((g) => ({ displayName: g.person.preferredName ?? g.person.firstName, rsvpStatus: null }))
    ];
    const items = await db.eventItem.findMany({ where: { eventId }, orderBy: { createdAt: "asc" } });
    res.json(toForeignInvitedEventDTO(access.event, participantList, items.map(serializeEventItem)));
    return;
  }
```

(Adjust to the handler's existing variable names; the existing owning-member path is unchanged.)

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && npx vitest run src/routes/__tests__/events.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/eventAccess.ts apps/api/src/routes/events.ts apps/api/src/routes/__tests__/events.test.ts
git commit -m "feat: P3-03 isolation-safe ForeignInvitedEventDTO for cross-family reads"
```

---

### Task 10: Participant-scoped notification recipients

**Files:**
- Modify: `apps/api/src/lib/notificationService.ts` (add a helper) OR `apps/api/src/lib/eventAccess.ts`
- Test: `apps/api/src/lib/__tests__/eventAccess.test.ts`

**Interfaces:** `eventNotificationRecipients(eventId): Promise<string[]>` — returns the personIds to notify for a shared event = owning-family members **+ active participants**, deduped. Never the full membership of a participant's *other* family. Future event-notification senders use this instead of family-membership queries.

- [ ] **Step 1: Write the failing test**

```typescript
it("recipients = owning members + active participants, deduped; excludes revoked and foreign-family non-participants", async () => {
  const owner = await seedTestPerson();
  const { familyGroup } = await seedTestFamily(owner.id);
  const ev = await seedEvent(familyGroup.id, owner.id);
  const part = await seedTestPerson();
  await db.eventParticipant.create({ data: { eventId: ev.id, personId: part.id, status: "ACTIVE" } });
  const revoked = await seedTestPerson();
  await db.eventParticipant.create({ data: { eventId: ev.id, personId: revoked.id, status: "REVOKED" } });
  const recips = await eventNotificationRecipients(ev.id);
  expect(recips).toContain(owner.id);
  expect(recips).toContain(part.id);
  expect(recips).not.toContain(revoked.id);
  expect(new Set(recips).size).toBe(recips.length); // deduped
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run src/lib/__tests__/eventAccess.test.ts`
Expected: FAIL — helper missing.

- [ ] **Step 3: Implement** (in `eventAccess.ts`)

```typescript
export async function eventNotificationRecipients(eventId: string): Promise<string[]> {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { familyGroupId: true } });
  if (!event) return [];
  const members = await db.familyMember.findMany({ where: { familyGroupId: event.familyGroupId }, select: { personId: true } });
  const grants = await db.eventParticipant.findMany({ where: { eventId, status: "ACTIVE" }, select: { personId: true } });
  return [...new Set([...members.map((m) => m.personId), ...grants.map((g) => g.personId)])];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && npx vitest run src/lib/__tests__/eventAccess.test.ts`
Expected: PASS.

- [ ] **Step 5: Full API suite + type-check**

Run: `cd apps/api && npx vitest run && npx tsc --noEmit`
Expected: all PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/eventAccess.ts apps/api/src/lib/__tests__/eventAccess.test.ts
git commit -m "feat: P3-03 participant-scoped event notification recipients"
```

---

## Out of scope (later plans)

- **W3a-UI** — web (invite a cross-family user, accept page, participant list + roles) and mobile parity. Consumes these endpoints.
- **W3b** — passive SMS "reply Y" + non-user onboarding + contact verification.
- Cross-family **photo upload + gift registry** contributions (deferred per spec §1).
- Wiring `eventNotificationRecipients` into a concrete shared-event notification trigger beyond what exists (this plan provides the helper; broad notification UX is W3a-UI/adjacent).

## Self-Review

- **Spec coverage:** EventParticipant model + roles (T1), grant predicate + resolver (T2), view access (T3), cross-family invite (T4), accept/decline (T5), revoke/role (T6), RSVP authz (T7), task contributions own-only (T8), ForeignInvitedEventDTO + isolation (T9), participant-scoped notifications (T10). Photos/registry explicitly excluded per spec §1/§5. ✓
- **Placeholder scan:** route-test "arrange" comments name the exact arrangement + assert the contract; all implementation steps carry real code. The Task-1 smoke test is explicitly replaced in Task 2. ✓
- **Type consistency:** `resolveEventAccess`/`activeEventParticipant`/`EventAccess` names + the `{ role }` shape are identical across T2 and their consumers (T4–T10); `EventRole`/`ParticipantStatus` literals match the schema (T1); `toForeignInvitedEventDTO` + `eventNotificationRecipients` signatures match their call sites. ✓
- **Auth seam:** every new/changed mutation routes authorization through `resolveEventAccess` (canView/canContribute/canAdmin), never raw membership — closing the cross-tenant gap. ✓
