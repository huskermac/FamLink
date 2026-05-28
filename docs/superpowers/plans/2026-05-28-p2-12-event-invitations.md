# P2-12: Event Invitations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full invitation system to events — three visibility modes, graph-aware suggestions (from P2-13), external guest RSVP via token link, and cross-family identity matching.

**Architecture:** Extend `EventInvitation` with external-guest and tracking fields. The existing RSVP model handles member RSVPs; `EventInvitation.status` handles external guest responses. A public Express route (no auth) serves external guest token lookups and RSVPs. The web gains a protected invite-step page and a public RSVP page.

**Prerequisite:** P2-13 must be complete (invitee suggestions endpoint must exist).

**Tech Stack:** Prisma 7, Express 4, Zod, Next.js 15 App Router, Clerk, Vitest

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `packages/db/prisma/schema.prisma` | Extend EventInvitation |
| Modify | `apps/api/src/routes/events.ts` | Replace POST invitations, add GET invitations + suggestions |
| Modify | `apps/api/src/routes/guest.ts` | Public invitation token endpoints |
| Modify | `apps/api/src/routes/index.ts` | No change needed — guest router already mounted |
| Modify | `apps/web/middleware.ts` | Add `/rsvp/(.*)` as public route |
| Modify | `apps/web/lib/api/events.ts` | New typed client functions |
| Create | `apps/web/app/rsvp/[token]/page.tsx` | Public RSVP page |
| Create | `apps/web/app/(protected)/events/[id]/invite/page.tsx` | Invite step page |
| Modify | `apps/api/src/__tests__/routes/events.test.ts` | New invitation tests |

---

## Task 1: Schema — Extend EventInvitation

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Edit EventInvitation model**

In `packages/db/prisma/schema.prisma`, replace the `EventInvitation` model (lines 166–178):

```prisma
model EventInvitation {
  id             String    @id @default(cuid())
  eventId        String
  event          Event     @relation(fields: [eventId], references: [id], onDelete: Cascade)
  personId       String?
  householdId    String?
  scope          String    @default("INDIVIDUAL")
  invitedById    String?
  guestEmail     String?
  guestPhone     String?
  guestName      String?
  guestToken     String?   @unique
  linkedPersonId String?
  status         String    @default("PENDING")
  sentAt         DateTime?
  createdAt      DateTime  @default(now())

  @@index([eventId])
  @@index([personId])
  @@index([guestToken])
}
```

- [ ] **Step 2: Generate and apply migration**

```bash
cd packages/db && npx prisma migrate dev --name event_invitation_external_guest && npx prisma generate
```

Expected: Migration applied. New columns added to `EventInvitation`. No existing rows broken (all new columns nullable/defaulted).

- [ ] **Step 3: Type-check**

```bash
cd apps/api && npm run type-check
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat: P2-12 schema — extend EventInvitation for external guests"
```

---

## Task 2: POST /events/:id/invitations — Replace Handler

**Files:**
- Modify: `apps/api/src/routes/events.ts`
- Modify: `apps/api/src/__tests__/routes/events.test.ts` (or create)

The existing handler uses `SendInvitationsSchema` (InviteScope-based). Replace it with a new handler that accepts individual invitees (persons + external guests), performs cross-family matching, and respects visibility-mode authorization.

- [ ] **Step 1: Write failing tests**

Check for `apps/api/src/__tests__/routes/events.test.ts`. If absent, create it with this boilerplate then add these tests:

```typescript
import { getAuth } from "@clerk/express";
import { db } from "@famlink/db";
import request from "supertest";
import { createApp } from "../../server";
import { TEST_CLERK_ID } from "../helpers/auth";
import { seedGuestPerson, seedTestEvent, seedTestFamily, seedTestPerson } from "../helpers/db";

vi.mock("@clerk/express", () => ({
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuth: vi.fn()
}));

describe("POST /api/v1/events/:eventId/invitations", () => {
  const app = createApp();
  const mockGetAuth = vi.mocked(getAuth) as any;

  beforeEach(() => { mockGetAuth.mockReset(); });

  it("invites a known family member by personId", async () => {
    const admin = await seedTestPerson();
    const member = await seedGuestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    await db.familyMember.create({
      data: { familyGroupId: familyGroup.id, personId: member.id, roles: ["MEMBER"], permissions: [] }
    });
    const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Party" });
    await db.event.update({ where: { id: event.id }, data: { eventVisibility: "PRIVATE" } });

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post(`/api/v1/events/${event.id}/invitations`)
      .set("Authorization", "Bearer mock")
      .send({ invitees: [{ personId: member.id }] });

    expect(res.status).toBe(201);
    expect(res.body.invited).toBe(1);
    const inv = await db.eventInvitation.findFirst({ where: { eventId: event.id, personId: member.id } });
    expect(inv).not.toBeNull();
  });

  it("creates external guest invitation with guestToken", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id);
    await db.event.update({ where: { id: event.id }, data: { eventVisibility: "OPEN" } });

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post(`/api/v1/events/${event.id}/invitations`)
      .set("Authorization", "Bearer mock")
      .send({ invitees: [{ guestEmail: "mia@example.com", guestName: "Mia Torres" }] });

    expect(res.status).toBe(201);
    expect(res.body.invited).toBe(1);
    const inv = await db.eventInvitation.findFirst({ where: { eventId: event.id, guestEmail: "mia@example.com" } });
    expect(inv).not.toBeNull();
    expect(inv!.guestToken).not.toBeNull();
  });

  it("cross-family match: links to existing FamLink user by email", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id);
    await db.event.update({ where: { id: event.id }, data: { eventVisibility: "OPEN" } });

    // Create a person in another family with a known email
    const otherPerson = await seedGuestPerson({ firstName: "Carol" });
    await db.person.update({ where: { id: otherPerson.id }, data: { email: "carol@example.com" } });

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post(`/api/v1/events/${event.id}/invitations`)
      .set("Authorization", "Bearer mock")
      .send({ invitees: [{ guestEmail: "carol@example.com", guestName: "Carol" }] });

    expect(res.status).toBe(201);
    const inv = await db.eventInvitation.findFirst({ where: { eventId: event.id } });
    expect(inv!.linkedPersonId).toBe(otherPerson.id);
  });

  it("returns 400 for BROADCAST event — invitations not needed", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id);
    // eventVisibility defaults to BROADCAST

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post(`/api/v1/events/${event.id}/invitations`)
      .set("Authorization", "Bearer mock")
      .send({ invitees: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/broadcast/i);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd apps/api && npm test -- events
```

Expected: FAIL — new schema fields and handler logic not yet updated.

- [ ] **Step 3: Add invitation helpers at top of events.ts**

After the existing imports in `apps/api/src/routes/events.ts`, add:

```typescript
import crypto from "crypto";

function generateInviteToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

async function matchPersonByContact(email?: string, phone?: string) {
  if (!email && !phone) return null;
  return db.person.findFirst({
    where: {
      OR: [
        ...(email ? [{ email }] : []),
        ...(phone ? [{ phone }] : [])
      ]
    },
    select: { id: true }
  });
}
```

- [ ] **Step 4: Replace the POST /invitations handler**

In `apps/api/src/routes/events.ts`, replace the entire `eventsRouter.post("/:eventId/invitations", ...)` block (lines 528–646) with:

```typescript
const InviteeSchema = z.union([
  z.object({ personId: z.string().min(1) }),
  z.object({
    guestEmail: z.string().email().optional(),
    guestPhone: z.string().min(7).optional(),
    guestName:  z.string().min(1)
  }).refine(d => d.guestEmail || d.guestPhone, { message: "guestEmail or guestPhone required" })
]);

const SendInvitationsV2Schema = z.object({
  invitees: z.array(InviteeSchema).min(1)
});

eventsRouter.post("/:eventId/invitations", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid event id" });
    return;
  }
  const { eventId } = p.data;

  const parsed = SendInvitationsV2Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
    return;
  }

  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  if (event.eventVisibility === "BROADCAST") {
    res.status(400).json({ error: "Broadcast events include all family members automatically — no invitations needed" });
    return;
  }

  const membership = await db.familyMember.findUnique({
    where: { familyGroupId_personId: { familyGroupId: event.familyGroupId, personId: requester.id } }
  });
  if (!membership) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }

  // PRIVATE: only organizer/admin can invite. OPEN: any member can invite.
  if (event.eventVisibility === "PRIVATE" && !hasAdminRole(membership) && event.createdByPersonId !== requester.id) {
    res.status(403).json({ error: "Only the event organizer or an admin can invite to a private event" });
    return;
  }

  const now = new Date();
  let invitedCount = 0;

  await db.$transaction(async (tx) => {
    for (const invitee of parsed.data.invitees) {
      if ("personId" in invitee) {
        const existing = await tx.eventInvitation.findFirst({
          where: { eventId, personId: invitee.personId }
        });
        if (!existing) {
          await tx.eventInvitation.create({
            data: {
              eventId,
              personId: invitee.personId,
              invitedById: requester.id,
              status: "PENDING",
              sentAt: now
            }
          });
          invitedCount += 1;
        }
      } else {
        // External guest
        const match = await matchPersonByContact(invitee.guestEmail, invitee.guestPhone);
        const existing = await tx.eventInvitation.findFirst({
          where: {
            eventId,
            OR: [
              ...(invitee.guestEmail ? [{ guestEmail: invitee.guestEmail }] : []),
              ...(invitee.guestPhone ? [{ guestPhone: invitee.guestPhone }] : [])
            ]
          }
        });
        if (!existing) {
          await tx.eventInvitation.create({
            data: {
              eventId,
              guestEmail:     invitee.guestEmail ?? null,
              guestPhone:     invitee.guestPhone ?? null,
              guestName:      invitee.guestName,
              guestToken:     generateInviteToken(),
              linkedPersonId: match?.id ?? null,
              invitedById:    requester.id,
              status:         "PENDING",
              sentAt:         now
            }
          });
          invitedCount += 1;
        }
      }
    }
  });

  res.status(201).json({ invited: invitedCount });
});
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd apps/api && npm test -- events
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/events.ts apps/api/src/__tests__/routes/events.test.ts
git commit -m "feat: P2-12 POST /events/:id/invitations — external guests, cross-family match"
```

---

## Task 3: GET /events/:id/invitations + GET /events/:id/invitee-suggestions

**Files:**
- Modify: `apps/api/src/routes/events.ts`

- [ ] **Step 1: Add GET /invitations handler**

In `apps/api/src/routes/events.ts`, after the POST invitations handler, add:

```typescript
eventsRouter.get("/:eventId/invitations", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid event id" });
    return;
  }
  const { eventId } = p.data;

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
    return;
  }

  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const membership = await db.familyMember.findUnique({
    where: { familyGroupId_personId: { familyGroupId: event.familyGroupId, personId: requester.id } }
  });
  if (!membership) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }

  const invitations = await db.eventInvitation.findMany({
    where: { eventId },
    include: {
      person: { select: { id: true, firstName: true, lastName: true, preferredName: true, profilePhotoUrl: true } }
    },
    orderBy: { createdAt: "asc" }
  });

  res.json({
    invitations: invitations.map(inv => ({
      id:            inv.id,
      personId:      inv.personId ?? null,
      displayName:   inv.person
        ? (inv.person.preferredName?.trim() || `${inv.person.firstName} ${inv.person.lastName}`.trim())
        : (inv.guestName ?? "Guest"),
      guestEmail:    inv.guestEmail ?? null,
      guestPhone:    inv.guestPhone ?? null,
      linkedPersonId:inv.linkedPersonId ?? null,
      invitedById:   inv.invitedById ?? null,
      status:        inv.status,
      sentAt:        inv.sentAt?.toISOString() ?? null,
    }))
  });
});
```

- [ ] **Step 2: Add GET /invitee-suggestions route**

After the GET invitations handler:

```typescript
import { getInviteeSuggestions } from "../lib/inviteeSuggestions";

eventsRouter.get("/:eventId/invitee-suggestions", async (req, res) => {
  const p = eventIdParam.safeParse(req.params);
  if (!p.success) {
    res.status(400).json({ error: "Invalid event id" });
    return;
  }
  const { eventId } = p.data;

  const { userId } = authed(req);
  const requester = await personForClerkUserId(userId);
  if (!requester) {
    res.status(400).json({ error: ERROR_PERSON_RECORD_REQUIRED });
    return;
  }

  const event = await db.event.findUnique({ where: { id: eventId } });
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const membership = await db.familyMember.findUnique({
    where: { familyGroupId_personId: { familyGroupId: event.familyGroupId, personId: requester.id } }
  });
  if (!membership) {
    res.status(403).json({ error: "Not a member of this family" });
    return;
  }

  // Invited persons are those already in the family + explicit invitations
  const explicitInvites = await db.eventInvitation.findMany({
    where: { eventId, personId: { not: null } },
    select: { personId: true }
  });
  const invitedPersonIds = [
    ...explicitInvites.map(i => i.personId as string),
    requester.id
  ];

  const suggestions = await getInviteeSuggestions({
    familyGroupId: event.familyGroupId,
    invitedPersonIds
  });

  res.json({ suggestions });
});
```

- [ ] **Step 3: Run full test suite**

```bash
cd apps/api && npm test
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/events.ts
git commit -m "feat: P2-12 GET /events/:id/invitations + invitee-suggestions"
```

---

## Task 4: Public Guest Invitation Endpoints

**Files:**
- Modify: `apps/api/src/routes/guest.ts`

These endpoints require no auth — they use the `guestToken` stored in `EventInvitation`.

- [ ] **Step 1: Write failing tests**

Add to `apps/api/src/__tests__/routes/events.test.ts` (or a new `guest-invitation.test.ts`):

```typescript
describe("Guest invitation token endpoints", () => {
  const app = createApp();

  it("GET /api/v1/guest/invitation/:token returns event info", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id, { title: "BBQ" });
    const token = "test-token-abc123";
    await db.eventInvitation.create({
      data: { eventId: event.id, guestEmail: "mia@example.com", guestName: "Mia",
              guestToken: token, status: "PENDING" }
    });

    const res = await request(app).get(`/api/v1/guest/invitation/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.event.title).toBe("BBQ");
    expect(res.body.guestName).toBe("Mia");
    expect(res.body.currentStatus).toBe("PENDING");
  });

  it("POST /api/v1/guest/invitation/:token/rsvp updates invitation status", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id);
    const token = "test-token-xyz789";
    await db.eventInvitation.create({
      data: { eventId: event.id, guestEmail: "mia@example.com", guestName: "Mia",
              guestToken: token, status: "PENDING" }
    });

    const res = await request(app)
      .post(`/api/v1/guest/invitation/${token}/rsvp`)
      .send({ status: "ACCEPTED" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ACCEPTED");

    const inv = await db.eventInvitation.findFirst({ where: { guestToken: token } });
    expect(inv!.status).toBe("ACCEPTED");
  });

  it("GET returns 404 for unknown token", async () => {
    const res = await request(app).get("/api/v1/guest/invitation/not-a-real-token");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd apps/api && npm test -- guest
```

Expected: FAIL — 404 for new routes.

- [ ] **Step 3: Add routes to guest.ts**

In `apps/api/src/routes/guest.ts`, append after the existing routes:

```typescript
const guestRsvpSchema = z.object({
  status: z.enum(["ACCEPTED", "DECLINED"])
});

guestRouter.get("/invitation/:token", async (req, res) => {
  const { token } = req.params;

  const invitation = await db.eventInvitation.findUnique({
    where: { guestToken: token },
    include: {
      event: {
        select: {
          id: true, title: true, description: true,
          startAt: true, endAt: true,
          locationName: true, locationAddress: true, locationMapUrl: true,
          familyGroup: { select: { id: true, name: true } }
        }
      }
    }
  });

  if (!invitation) {
    res.status(404).json({ error: "Invitation not found" });
    return;
  }

  res.json({
    event: {
      id:              invitation.event.id,
      title:           invitation.event.title,
      description:     invitation.event.description,
      startAt:         invitation.event.startAt.toISOString(),
      endAt:           invitation.event.endAt?.toISOString() ?? null,
      locationName:    invitation.event.locationName,
      locationAddress: invitation.event.locationAddress,
      locationMapUrl:  invitation.event.locationMapUrl,
      familyGroup:     invitation.event.familyGroup
    },
    guestName:     invitation.guestName,
    currentStatus: invitation.status
  });
});

guestRouter.post("/invitation/:token/rsvp", async (req, res) => {
  const { token } = req.params;
  const parsed = guestRsvpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid RSVP body" });
    return;
  }

  const invitation = await db.eventInvitation.findUnique({
    where: { guestToken: token }
  });
  if (!invitation) {
    res.status(404).json({ error: "Invitation not found" });
    return;
  }

  await db.eventInvitation.update({
    where: { id: invitation.id },
    data: { status: parsed.data.status }
  });

  res.json({ ok: true, status: parsed.data.status });
});
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd apps/api && npm test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/guest.ts apps/api/src/__tests__/routes/
git commit -m "feat: P2-12 public guest invitation endpoints — GET event info + POST RSVP"
```

---

## Task 5: Web Middleware — Add Public RSVP Route

**Files:**
- Modify: `apps/web/middleware.ts`
- Modify: `apps/web/lib/api/events.ts`

- [ ] **Step 1: Add /rsvp/(.*) to public routes**

In `apps/web/middleware.ts`, update `isPublicRoute`:

```typescript
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/rsvp(.*)",
  "/api/v1/guest/(.*)"
]);
```

- [ ] **Step 2: Add typed API client functions to events.ts**

In `apps/web/lib/api/events.ts`, append:

```typescript
export interface InviteeEntry {
  personId?: string;
  guestEmail?: string;
  guestPhone?: string;
  guestName?: string;
}

export interface InvitationRecord {
  id: string;
  personId: string | null;
  displayName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  linkedPersonId: string | null;
  invitedById: string | null;
  status: string;
  sentAt: string | null;
}

export interface InviteeSuggestion {
  person: { id: string; displayName: string; avatarUrl: string | null };
  via: { personId: string; personName: string; relationshipType: string; relationshipState: string };
  sharedChildren: { id: string; displayName: string }[];
}

export async function sendInvitations(
  eventId: string,
  invitees: InviteeEntry[],
  getToken: () => Promise<string | null>
): Promise<{ invited: number }> {
  return apiFetch(`/events/${eventId}/invitations`, {
    method: "POST",
    body: JSON.stringify({ invitees }),
    getToken
  });
}

export async function getEventInvitations(
  eventId: string,
  getToken: () => Promise<string | null>
): Promise<{ invitations: InvitationRecord[] }> {
  return apiFetch(`/events/${eventId}/invitations`, { getToken });
}

export async function getEventInviteeSuggestions(
  eventId: string,
  getToken: () => Promise<string | null>
): Promise<{ suggestions: InviteeSuggestion[] }> {
  return apiFetch(`/events/${eventId}/invitee-suggestions`, { getToken });
}

export async function getGuestInvitation(token: string): Promise<{
  event: { id: string; title: string; startAt: string; endAt: string | null; locationName: string | null; familyGroup: { name: string } };
  guestName: string | null;
  currentStatus: string;
}> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const res = await fetch(`${apiBase}/api/v1/guest/invitation/${token}`);
  if (!res.ok) throw new Error("Invitation not found");
  return res.json();
}

export async function submitGuestRsvp(token: string, status: "ACCEPTED" | "DECLINED"): Promise<{ ok: boolean; status: string }> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const res = await fetch(`${apiBase}/api/v1/guest/invitation/${token}/rsvp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  if (!res.ok) throw new Error("RSVP failed");
  return res.json();
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/middleware.ts apps/web/lib/api/events.ts
git commit -m "feat: P2-12 web middleware public RSVP route + typed API client functions"
```

---

## Task 6: Web — Public RSVP Page

**Files:**
- Create: `apps/web/app/rsvp/[token]/page.tsx`

This page lives outside the `(protected)` group so it requires no auth. It fetches event info server-side and shows Accept/Decline buttons via a client component.

- [ ] **Step 1: Create the client component for RSVP buttons**

Create `apps/web/app/rsvp/[token]/RsvpButtons.tsx`:

```tsx
"use client";
import { useState } from "react";
import { submitGuestRsvp } from "@/lib/api/events";

interface Props {
  token: string;
  initialStatus: string;
}

export function RsvpButtons({ token, initialStatus }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [loading, setLoading] = useState(false);

  async function respond(next: "ACCEPTED" | "DECLINED") {
    setLoading(true);
    try {
      const result = await submitGuestRsvp(token, next);
      setStatus(result.status);
    } finally {
      setLoading(false);
    }
  }

  if (status === "ACCEPTED") {
    return (
      <div style={{ textAlign: "center", padding: "24px" }}>
        <div style={{ fontSize: "32px", marginBottom: "8px" }}>✓</div>
        <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>You're going!</p>
        <button
          onClick={() => respond("DECLINED")}
          disabled={loading}
          style={{ marginTop: "12px", fontSize: "13px", color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
        >
          Can't make it after all
        </button>
      </div>
    );
  }

  if (status === "DECLINED") {
    return (
      <div style={{ textAlign: "center", padding: "24px" }}>
        <p style={{ color: "var(--text-secondary)" }}>You've declined this invitation.</p>
        <button
          onClick={() => respond("ACCEPTED")}
          disabled={loading}
          style={{ marginTop: "12px", fontSize: "13px", color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
        >
          Changed your mind?
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: "12px", justifyContent: "center", padding: "24px 0" }}>
      <button
        onClick={() => respond("ACCEPTED")}
        disabled={loading}
        style={{
          padding: "12px 32px", borderRadius: "8px", border: "none",
          background: "var(--color-green-600, #16a34a)", color: "#fff",
          fontSize: "15px", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer"
        }}
      >
        Accept
      </button>
      <button
        onClick={() => respond("DECLINED")}
        disabled={loading}
        style={{
          padding: "12px 32px", borderRadius: "8px", border: "1px solid var(--border)",
          background: "var(--bg-card)", color: "var(--text-primary)",
          fontSize: "15px", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer"
        }}
      >
        Decline
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create the server page**

Create `apps/web/app/rsvp/[token]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getGuestInvitation } from "@/lib/api/events";
import { RsvpButtons } from "./RsvpButtons";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function RsvpPage({ params }: Props) {
  const { token } = await params;

  let data: Awaited<ReturnType<typeof getGuestInvitation>>;
  try {
    data = await getGuestInvitation(token);
  } catch {
    notFound();
  }

  const { event, guestName, currentStatus } = data;

  const date = new Date(event.startAt).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  });
  const time = new Date(event.startAt).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit"
  });

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--bg-page, #f8fafc)", padding: "24px"
    }}>
      <div style={{
        maxWidth: "480px", width: "100%", background: "var(--bg-card, #fff)",
        borderRadius: "12px", border: "1px solid var(--border, #e2e8f0)",
        padding: "32px", boxShadow: "0 4px 16px rgba(0,0,0,0.08)"
      }}>
        <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: ".05em" }}>
          {event.familyGroup.name}
        </p>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--text-primary)", margin: "0 0 16px" }}>
          {event.title}
        </h1>
        <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "8px" }}>
          📅 {date} at {time}
        </div>
        {event.locationName && (
          <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "16px" }}>
            📍 {event.locationName}
          </div>
        )}
        {guestName && (
          <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "0" }}>
            You're invited, <strong>{guestName}</strong>.
          </p>
        )}
        <RsvpButtons token={token} initialStatus={currentStatus} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
cd apps/web && npm run type-check
```

Expected: 0 errors

- [ ] **Step 4: Manual smoke test**

Start the API and web dev servers. Manually create an EventInvitation with a guestToken in the DB (via seed or direct insert), then visit `http://localhost:3000/rsvp/<token>`. Verify:
- Event info is displayed
- Accept/Decline buttons appear
- Clicking Accept updates the button state and the DB row

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/rsvp/"
git commit -m "feat: P2-12 public RSVP page /rsvp/[token]"
```

---

## Task 7: Web — Invite Step Page

**Files:**
- Create: `apps/web/app/(protected)/events/[id]/invite/page.tsx`

Shown after creating an OPEN or PRIVATE event. Displays family members checklist, graph suggestions, and external guest entry.

- [ ] **Step 1: Create the invite page**

Create `apps/web/app/(protected)/events/[id]/invite/page.tsx`:

```tsx
"use client";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { getEventInviteeSuggestions, sendInvitations } from "@/lib/api/events";
import type { InviteeEntry, InviteeSuggestion } from "@/lib/api/events";
import { useFamilyId } from "@/hooks/useFamilyId";
import { apiFetch } from "@/lib/api";

export default function InvitePage() {
  const { id: eventId } = useParams<{ id: string }>();
  const router = useRouter();
  const { getToken } = useAuth();
  const familyId = useFamilyId();

  const [selectedPersonIds, setSelectedPersonIds] = useState<Set<string>>(new Set());
  const [externalName, setExternalName]   = useState("");
  const [externalEmail, setExternalEmail] = useState("");
  const [externalPhone, setExternalPhone] = useState("");
  const [sending, setSending] = useState(false);

  // Family members
  const { data: membersData } = useQuery({
    queryKey: ["family-members", familyId],
    queryFn:  () => familyId ? apiFetch(`/families/${familyId}/members`, { getToken }) : null,
    enabled:  !!familyId
  });

  // Graph suggestions (based on currently selected members)
  const { data: suggestionsData } = useQuery({
    queryKey: ["invitee-suggestions", eventId],
    queryFn:  () => getEventInviteeSuggestions(eventId, getToken),
    enabled:  !!eventId
  });

  function togglePerson(personId: string) {
    setSelectedPersonIds(prev => {
      const next = new Set(prev);
      next.has(personId) ? next.delete(personId) : next.add(personId);
      return next;
    });
  }

  async function handleSend() {
    setSending(true);
    const invitees: InviteeEntry[] = [
      ...[...selectedPersonIds].map(id => ({ personId: id })),
      ...(externalEmail || externalPhone
        ? [{ guestEmail: externalEmail || undefined, guestPhone: externalPhone || undefined, guestName: externalName || "Guest" }]
        : [])
    ];
    if (invitees.length > 0) {
      await sendInvitations(eventId, invitees, getToken);
    }
    router.push(`/events/${eventId}`);
  }

  const members: Array<{ personId: string; displayName: string }> = membersData?.members ?? [];
  const suggestions: InviteeSuggestion[] = suggestionsData?.suggestions ?? [];

  return (
    <div style={{ maxWidth: "540px", margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "4px" }}>
        Invite people
      </h1>
      <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "24px" }}>
        Select family members or add external guests.
      </p>

      {/* Family members */}
      {members.length > 0 && (
        <section style={{ marginBottom: "24px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "8px" }}>
            Family members
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {members.map((m: any) => (
              <label key={m.personId} style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer",
                                               background: "var(--bg-card)", border: "1px solid var(--border)",
                                               borderRadius: "8px", padding: "10px 12px" }}>
                <input
                  type="checkbox"
                  checked={selectedPersonIds.has(m.personId)}
                  onChange={() => togglePerson(m.personId)}
                  style={{ accentColor: "var(--color-primary, #6366f1)", width: "16px", height: "16px" }}
                />
                <span style={{ fontSize: "14px", color: "var(--text-primary)" }}>{m.displayName}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      {/* Graph suggestions */}
      {suggestions.length > 0 && (
        <section style={{ marginBottom: "24px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "8px" }}>
            Suggested guests
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {suggestions.map(s => (
              <label key={s.person.id} style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer",
                                                background: "var(--bg-card)", border: "1px solid var(--border)",
                                                borderRadius: "8px", padding: "10px 12px" }}>
                <input
                  type="checkbox"
                  checked={selectedPersonIds.has(s.person.id)}
                  onChange={() => togglePerson(s.person.id)}
                  style={{ accentColor: "var(--color-primary, #6366f1)", width: "16px", height: "16px" }}
                />
                <div>
                  <div style={{ fontSize: "14px", color: "var(--text-primary)" }}>{s.person.displayName}</div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    via {s.via.personName} · {s.via.relationshipType.toLowerCase()}
                    {s.sharedChildren.length > 0 && ` · co-parent of ${s.sharedChildren.map(c => c.displayName).join(", ")}`}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </section>
      )}

      {/* External guest */}
      <section style={{ marginBottom: "24px" }}>
        <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "8px" }}>
          External guest
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <input
            placeholder="Name"
            value={externalName}
            onChange={e => setExternalName(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--border)",
                     background: "var(--bg-card)", fontSize: "14px", color: "var(--text-primary)" }}
          />
          <input
            placeholder="Email address"
            type="email"
            value={externalEmail}
            onChange={e => setExternalEmail(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--border)",
                     background: "var(--bg-card)", fontSize: "14px", color: "var(--text-primary)" }}
          />
          <input
            placeholder="Phone (optional)"
            type="tel"
            value={externalPhone}
            onChange={e => setExternalPhone(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--border)",
                     background: "var(--bg-card)", fontSize: "14px", color: "var(--text-primary)" }}
          />
        </div>
      </section>

      {/* Actions */}
      <div style={{ display: "flex", gap: "12px" }}>
        <button
          onClick={handleSend}
          disabled={sending}
          style={{ flex: 1, padding: "12px", borderRadius: "8px", border: "none",
                   background: "var(--color-primary, #6366f1)", color: "#fff",
                   fontSize: "15px", fontWeight: 600, cursor: sending ? "not-allowed" : "pointer" }}
        >
          {sending ? "Sending…" : "Send invitations"}
        </button>
        <button
          onClick={() => router.push(`/events/${eventId}`)}
          style={{ padding: "12px 20px", borderRadius: "8px", border: "1px solid var(--border)",
                   background: "var(--bg-card)", color: "var(--text-secondary)",
                   fontSize: "14px", cursor: "pointer" }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Redirect to invite step after event creation for OPEN/PRIVATE events**

In `apps/web/app/(protected)/events/new/page.tsx`, after a successful event creation, check `eventVisibility` and redirect accordingly. Find the `router.push` call after `createEvent(...)` and replace with:

```typescript
const { eventVisibility } = formData; // however the form captures this field
if (eventVisibility === "OPEN" || eventVisibility === "PRIVATE") {
  router.push(`/events/${created.id}/invite`);
} else {
  router.push(`/events/${created.id}`);
}
```

> Check the actual form state variable name in the existing page before making this edit.

- [ ] **Step 3: Type-check**

```bash
cd apps/web && npm run type-check
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(protected)/events/"
git commit -m "feat: P2-12 invite step page + post-creation redirect for OPEN/PRIVATE events"
```

---

## Task 8: Final Test Run + Type-Check

- [ ] **Step 1: Full API test suite**

```bash
cd apps/api && npm test
```

Expected: all tests PASS

- [ ] **Step 2: Type-check both apps**

```bash
cd apps/api && npm run type-check && cd ../web && npm run type-check
```

Expected: 0 errors in both

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: P2-12 complete — event invitations, external guests, graph suggestions, public RSVP"
```
