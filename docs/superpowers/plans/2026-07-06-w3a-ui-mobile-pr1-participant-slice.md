# W3a-UI-mobile PR 1 (Participant Slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cross-family events discoverable and fully usable on the FamLink mobile app (foreign-event viewer, RSVP with own-status, task add/claim/delete-own), with the three additive API changes that enable it, and bring mobile into CI.

**Architecture:** Three additive API routes/fields on the existing Express events router; mobile-local port following existing patterns (domain hooks with react-query + expo-router screens + jest-expo tests). The event-detail route becomes a thin shape-discriminating branch over two extracted components (`OwnEventDetail`, `ForeignEventDetail`). Spec: `docs/superpowers/specs/2026-07-06-w3a-ui-mobile-design.md` (council-reviewed, Steve-approved).

**Tech Stack:** Express + Prisma + Zod + vitest/supertest (API); React Native 0.74 / Expo 51 / expo-router 3.5 / NativeWind 4 / @tanstack/react-query 5 / jest-expo + @testing-library/react-native (mobile).

## Global Constraints

- **Isolation invariants (spec §6):** foreign surfaces render ONLY `ForeignInvitedEventDTO` fields; discovery responses are allowlist-only (`id, title, startAt, endAt, locationName, eventType` — NO `familyGroupId`, family name, roster, or inviter); failure states are generic ("This event is no longer available"); the "Guest" badge never names a family.
- **`participants[]` contract is non-widenable:** `Array<{ displayName: string; rsvpStatus: string | null }>` — no `personId`.
- **Route ordering:** any literal path on `eventsRouter` (e.g. `/participating`) MUST be registered BEFORE the `/:eventId` route (line ~283 of `apps/api/src/routes/events.ts`), or Express captures the literal as an eventId. `/participation/preview` at line ~240 is the existing precedent.
- **Verification per task:** run the commands shown; final task runs full API + web + mobile suites, repo-root `npm run type-check`, repo-root `npm run lint` (eslint errors fail CI — never skip lint).
- **Commit format:** `feat: P3-03 <description>` / `fix:` / `chore:` / `ci:` as appropriate.
- **Copy rules:** foreign failure state text is exactly "This event is no longer available"; the foreign badge text is exactly "Guest".
- Windows dev machine: invoke test commands via `npm.cmd` if plain `npm` fails in your shell.
- Do not modify `apps/web/**` in this PR.

**Working state note:** commit after every task; the workspace must type-check at every commit.

---

### Task 1: API — `POST /:eventId/items/:itemId/claim`

The claim endpoint (spec §3.3). Claiming was previously impossible via the items routes (`PatchItemSchema` has no assignee; `authorizeItemMutation` is admin-or-creator). Mobile's old `PUT /potluck` call was broken (route is POST-only).

**Files:**
- Modify: `apps/api/src/routes/events.ts` (add route after the DELETE `/:eventId/items/:itemId` route, ~line 1103)
- Test: `apps/api/src/__tests__/routes/events.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: existing `resolveEventAccess`, `foreignItemShape`, `serializeEventItem`, `personed` (all already imported in `events.ts`).
- Produces: `POST /api/v1/events/:eventId/items/:itemId/claim` → 200 with the item (member shape: full `serializeEventItem`; foreign shape: `{ id, name, quantity, notes, status, isOwn }`), 403 non-contributor, 404 missing item/event, 409 not UNCLAIMED. Task 5's `useClaimItem` calls this.

- [ ] **Step 1: Write the failing tests** — append to `apps/api/src/__tests__/routes/events.test.ts` (reuse the file's existing imports/helpers: `seedTestPerson`, `seedSecondPerson`, `seedTestFamily`, `seedTestEvent`, `mockGetAuth`, `TEST_CLERK_ID`, `TEST_USER_2_CLERK_ID`, `request`, `app`, `db`):

```ts
// ── W3a-UI-mobile Task 1: POST /:eventId/items/:itemId/claim ─────────────
describe("POST /api/v1/events/:eventId/items/:itemId/claim", () => {
  it("member claims an UNCLAIMED item: assigns self and sets CLAIMED", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id);
    const item = await db.eventItem.create({
      data: { eventId: event.id, createdByPersonId: admin.id, name: "Salad" }
    });

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post(`/api/v1/events/${event.id}/items/${item.id}/claim`)
      .set("Authorization", "Bearer mock");

    expect(res.status).toBe(200);
    expect(res.body.assignedToPersonId).toBe(admin.id);
    expect(res.body.status).toBe("CLAIMED");
  });

  it("cross-family ACTIVE participant claims: 200 with foreign shape (no person ids)", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const participant = await seedSecondPerson();
    const event = await seedTestEvent(familyGroup.id, admin.id);
    await db.eventParticipant.create({
      data: { eventId: event.id, personId: participant.id, role: "PARTICIPANT", status: "ACTIVE" }
    });
    const item = await db.eventItem.create({
      data: { eventId: event.id, createdByPersonId: admin.id, name: "Cups" }
    });

    mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
    const res = await request(app)
      .post(`/api/v1/events/${event.id}/items/${item.id}/claim`)
      .set("Authorization", "Bearer mock");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CLAIMED");
    expect(res.body.isOwn).toBe(false);
    // foreign shape must not leak person ids
    expect(res.body.assignedToPersonId).toBeUndefined();
    expect(res.body.createdByPersonId).toBeUndefined();
    // but the DB row is really assigned to the participant
    const updated = await db.eventItem.findUnique({ where: { id: item.id } });
    expect(updated?.assignedToPersonId).toBe(participant.id);
  });

  it("409 when the item is not UNCLAIMED", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id);
    const item = await db.eventItem.create({
      data: { eventId: event.id, createdByPersonId: admin.id, name: "Taken", status: "CLAIMED", assignedToPersonId: admin.id }
    });

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post(`/api/v1/events/${event.id}/items/${item.id}/claim`)
      .set("Authorization", "Bearer mock");
    expect(res.status).toBe(409);
  });

  it("403 for a non-member non-participant; 404 for a missing item", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id);
    const item = await db.eventItem.create({
      data: { eventId: event.id, createdByPersonId: admin.id, name: "Nope" }
    });
    await seedSecondPerson(); // authenticated but unrelated

    mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
    const forbidden = await request(app)
      .post(`/api/v1/events/${event.id}/items/${item.id}/claim`)
      .set("Authorization", "Bearer mock");
    // resolveEventAccess reports not_found for a non-viewable event (isolation)
    expect([403, 404]).toContain(forbidden.status);

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const missing = await request(app)
      .post(`/api/v1/events/${event.id}/items/nonexistent/claim`)
      .set("Authorization", "Bearer mock");
    expect(missing.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=@famlink/api -- --run -t "items/:itemId/claim"`
Expected: FAIL — 404s (route does not exist).

- [ ] **Step 3: Implement the route** — in `apps/api/src/routes/events.ts`, directly after the `eventsRouter.delete("/:eventId/items/:itemId", ...)` handler (~line 1103):

```ts
eventsRouter.post("/:eventId/items/:itemId/claim", async (req, res) => {
  const requester = personed(req).person;
  const access = await resolveEventAccess(req.params.eventId, requester.id);
  if ("error" in access) { res.status(404).json({ error: "Event not found" }); return; }
  if (!access.canContribute) { res.status(403).json({ error: "Not authorized to contribute to this event" }); return; }
  const item = await db.eventItem.findFirst({ where: { id: req.params.itemId, eventId: req.params.eventId } });
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }
  if (item.status !== "UNCLAIMED") { res.status(409).json({ error: "Item already claimed" }); return; }
  const updated = await db.eventItem.update({
    where: { id: item.id },
    data: { assignedToPersonId: requester.id, status: "CLAIMED" }
  });
  const isForeign = !access.isOwningMember && access.eventRole !== null;
  res.json(isForeign ? foreignItemShape(updated, requester.id) : serializeEventItem(updated));
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=@famlink/api -- --run -t "items/:itemId/claim"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/events.ts apps/api/src/__tests__/routes/events.test.ts
git commit -m "feat: P3-03 claim endpoint for event items (POST /items/:itemId/claim)"
```

---

### Task 2: API — `myRsvp` on the foreign DTO

**Files:**
- Modify: `apps/api/src/lib/eventAccess.ts:6-24` (`toForeignInvitedEventDTO` signature)
- Modify: `apps/api/src/routes/events.ts:366-397` (the foreign-DTO branch of `GET /:eventId`)
- Test: `apps/api/src/__tests__/routes/events.test.ts`

**Interfaces:**
- Consumes: the foreign branch already fetches `rsvps` (`db.rSVP.findMany({ where: { eventId }, select: { personId, status } })`) and builds `rsvpByPerson: Map<string, string>`.
- Produces: `toForeignInvitedEventDTO(event, participants, tasks, myRsvp: string | null)`; the DTO JSON gains `myRsvp: "YES" | "NO" | "MAYBE" | null`. Task 4's `ForeignInvitedEventDTO` type and Task 8's RSVP highlight depend on this field name.

- [ ] **Step 1: Write the failing test** — append inside the existing `describe("GET /api/v1/events/:eventId — cross-family DTO (Task 9)")` block in `events.test.ts`:

```ts
    it("foreign DTO includes the requester's own RSVP as myRsvp (personId-scoped)", async () => {
      const admin = await seedTestPerson();
      const { familyGroup } = await seedTestFamily(admin.id);
      const participant = await seedSecondPerson();
      const event = await seedTestEvent(familyGroup.id, admin.id, { title: "MyRsvp Event" });
      await db.eventParticipant.create({
        data: { eventId: event.id, personId: participant.id, role: "PARTICIPANT", status: "ACTIVE" }
      });
      // the admin's RSVP must NOT bleed into the participant's myRsvp
      await db.rSVP.create({ data: { eventId: event.id, personId: admin.id, status: "NO" } });

      mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
      const before = await request(app)
        .get(`/api/v1/events/${event.id}`)
        .set("Authorization", "Bearer mock");
      expect(before.status).toBe(200);
      expect(before.body.myRsvp).toBeNull();

      await db.rSVP.create({ data: { eventId: event.id, personId: participant.id, status: "YES" } });
      const after = await request(app)
        .get(`/api/v1/events/${event.id}`)
        .set("Authorization", "Bearer mock");
      expect(after.body.myRsvp).toBe("YES");
    });
```

*(If `db.rSVP.create` requires additional non-null columns in the schema, mirror whatever the file's existing RSVP seeding does — search `rSVP.create` in this test file for the established shape.)*

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=@famlink/api -- --run -t "myRsvp"`
Expected: FAIL — `myRsvp` undefined.

- [ ] **Step 3: Implement.** In `apps/api/src/lib/eventAccess.ts`, change `toForeignInvitedEventDTO` to:

```ts
export function toForeignInvitedEventDTO(
  event: Event,
  participants: Array<{ displayName: string; rsvpStatus: string | null }>,
  tasks: Array<Record<string, unknown>>,
  myRsvp: string | null
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
    tasks,
    myRsvp
  };
}
```

In `apps/api/src/routes/events.ts` foreign branch (~line 395), the call site becomes:

```ts
res.json(toForeignInvitedEventDTO(event, participantList, foreignTasks, rsvpByPerson.get(requester.id) ?? null));
```

(`rsvpByPerson` is already built a few lines above — requester-personId-scoped lookup, per spec §3.2.)

- [ ] **Step 4: Run the full events test file** (the signature change touches the existing foreign-DTO tests)

Run: `npm test --workspace=@famlink/api -- --run src/__tests__/routes/events.test.ts`
Expected: PASS, including the new test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/eventAccess.ts apps/api/src/routes/events.ts apps/api/src/__tests__/routes/events.test.ts
git commit -m "feat: P3-03 myRsvp on ForeignInvitedEventDTO"
```

---

### Task 3: API — `GET /api/v1/events/participating`

**Files:**
- Modify: `apps/api/src/routes/events.ts` — register **immediately after** the `/participation/preview` handler (~line 281) and **BEFORE** `eventsRouter.get("/:eventId", ...)` (~line 283). This ordering is mandatory (Global Constraints).
- Test: `apps/api/src/__tests__/routes/events.test.ts`

**Interfaces:**
- Consumes: `personed`, `db`, `z` (already imported).
- Produces: `GET /api/v1/events/participating?days=N` → `{ events: Array<{ id, title, startAt, endAt, locationName, eventType }>, generatedAt }`. Task 4's `useParticipatingEvents` consumes this exact shape.

- [ ] **Step 1: Write the failing tests** — append to `events.test.ts`:

```ts
// ── W3a-UI-mobile Task 3: GET /events/participating ──────────────────────
describe("GET /api/v1/events/participating", () => {
  it("returns allowlisted summaries for ACTIVE cross-family grants only", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const me = await seedSecondPerson();
    const activeEvent = await seedTestEvent(familyGroup.id, admin.id, { title: "Foreign Active" });
    const revokedEvent = await seedTestEvent(familyGroup.id, admin.id, { title: "Foreign Revoked" });
    await db.eventParticipant.create({
      data: { eventId: activeEvent.id, personId: me.id, role: "PARTICIPANT", status: "ACTIVE" }
    });
    await db.eventParticipant.create({
      data: { eventId: revokedEvent.id, personId: me.id, role: "PARTICIPANT", status: "REVOKED" }
    });

    mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
    const res = await request(app)
      .get("/api/v1/events/participating")
      .set("Authorization", "Bearer mock");

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    const e = res.body.events[0];
    expect(e.id).toBe(activeEvent.id);
    expect(e.title).toBe("Foreign Active");
    // allowlist only — nothing else
    expect(Object.keys(e).sort()).toEqual(["endAt", "eventType", "id", "locationName", "startAt", "title"]);
  });

  it("multi-family dedupe: excludes events in ANY of the requester's own families", async () => {
    // me is a member of family B; an event in B where I also hold a grant must NOT appear
    const admin = await seedTestPerson();
    const { familyGroup: familyB } = await seedTestFamily(admin.id);
    const me = await seedSecondPerson();
    await db.familyMember.create({
      data: { familyGroupId: familyB.id, personId: me.id, roles: [], permissions: [] }
    });
    const eventInB = await seedTestEvent(familyB.id, admin.id, { title: "Own-family event" });
    await db.eventParticipant.create({
      data: { eventId: eventInB.id, personId: me.id, role: "PARTICIPANT", status: "ACTIVE" }
    });

    mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
    const res = await request(app)
      .get("/api/v1/events/participating")
      .set("Authorization", "Bearer mock");
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(0);
  });

  it("respects the days window (clamped 1-90)", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const me = await seedSecondPerson();
    const soon = await seedTestEvent(familyGroup.id, admin.id, {
      title: "Soon", startAt: new Date(Date.now() + 2 * 86_400_000)
    });
    const far = await seedTestEvent(familyGroup.id, admin.id, {
      title: "Far", startAt: new Date(Date.now() + 60 * 86_400_000)
    });
    for (const ev of [soon, far]) {
      await db.eventParticipant.create({
        data: { eventId: ev.id, personId: me.id, role: "PARTICIPANT", status: "ACTIVE" }
      });
    }

    mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
    const res = await request(app)
      .get("/api/v1/events/participating?days=7")
      .set("Authorization", "Bearer mock");
    expect(res.body.events.map((e: { title: string }) => e.title)).toEqual(["Soon"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=@famlink/api -- --run -t "events/participating"`
Expected: FAIL — the literal path currently falls through to `/:eventId` and 400s/404s.

- [ ] **Step 3: Implement** — insert between the `/participation/preview` handler and `eventsRouter.get("/:eventId", ...)`:

```ts
const ParticipatingQuerySchema = z.object({ days: z.coerce.number().int().optional() });

eventsRouter.get("/participating", async (req, res) => {
  const q = ParticipatingQuerySchema.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: "Invalid query", details: q.error.flatten() }); return; }
  const days = Math.min(90, Math.max(1, q.data.days ?? 30));
  const requester = personed(req).person;
  const now = new Date();
  const windowEnd = new Date(now.getTime() + days * 86_400_000);

  // Dedupe against ALL of the requester's family memberships (including
  // suspended): membership events arrive via calendar/upcoming, and
  // suspension must not open a side door through this route.
  const memberships = await db.familyMember.findMany({
    where: { personId: requester.id },
    select: { familyGroupId: true }
  });
  const grants = await db.eventParticipant.findMany({
    where: { personId: requester.id, status: "ACTIVE" },
    select: { eventId: true }
  });
  const events = await db.event.findMany({
    where: {
      id: { in: grants.map((g) => g.eventId) },
      familyGroupId: { notIn: memberships.map((m) => m.familyGroupId) },
      startAt: { gte: now, lte: windowEnd }
    },
    orderBy: [{ startAt: "asc" }, { id: "asc" }]
  });
  res.json({
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      startAt: e.startAt.toISOString(),
      endAt: e.endAt?.toISOString() ?? null,
      locationName: e.locationName,
      eventType: e.eventType
    })),
    generatedAt: new Date().toISOString()
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npm test --workspace=@famlink/api -- --run -t "events/participating"`
Expected: PASS (3 tests). Then run the whole file: `npm test --workspace=@famlink/api -- --run src/__tests__/routes/events.test.ts` — PASS (no route-ordering regressions).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/events.ts apps/api/src/__tests__/routes/events.test.ts
git commit -m "feat: P3-03 GET /events/participating discovery endpoint"
```

---

### Task 4: Mobile — foreign types, discriminator, `useParticipatingEvents`

**Files:**
- Modify: `apps/mobile/hooks/useEvents.ts`
- Test: `apps/mobile/__tests__/hooks/useEvents.test.ts`

**Interfaces:**
- Consumes: `useApiFetch` from `../lib/api` (existing); Task 3's response shape; Task 2's `myRsvp`.
- Produces (Tasks 6–8 depend on these exact names):
  - `interface ForeignParticipantEntry { displayName: string; rsvpStatus: string | null }`
  - `interface ForeignTask { id: string; name: string; quantity: string | null; notes: string | null; status: "UNCLAIMED" | "CLAIMED" | "PROVIDED" | "CANCELLED"; isOwn: boolean }`
  - `interface ForeignInvitedEventDTO { id: string; title: string; description: string | null; startAt: string; endAt: string | null; locationName: string | null; locationAddress: string | null; locationMapUrl: string | null; eventType: string; participants: ForeignParticipantEntry[]; tasks: ForeignTask[]; myRsvp: "YES" | "NO" | "MAYBE" | null }`
  - `type EventDetailResponse = EventDetail | ForeignInvitedEventDTO`
  - `function isForeignEvent(d: EventDetailResponse): d is ForeignInvitedEventDTO` — **`return !("event" in d)`** (the OWN shape has the `event` wrapper; do not invert)
  - `interface ParticipatingEventSummary { id: string; title: string; startAt: string; endAt: string | null; locationName: string | null; eventType: string }`
  - `function useParticipatingEvents(days?: number)` → query key `["participating-events", days]`, fetches `/api/v1/events/participating?days=${days}` (default 30)
  - `useEvent(eventId)` now returns `UseQueryResult<EventDetailResponse>` with `retry: false`

- [ ] **Step 1: Write the failing tests** — append to `apps/mobile/__tests__/hooks/useEvents.test.ts` (the file already mocks `useApiFetch` and defines `wrapper`):

```ts
import { useParticipatingEvents, isForeignEvent } from "../../hooks/useEvents";
import type { EventDetailResponse } from "../../hooks/useEvents";
// (merge these imports into the existing import lines at the top of the file)

describe("useParticipatingEvents", () => {
  it("fetches /api/v1/events/participating with the days window", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      events: [{ id: "f1", title: "Foreign BBQ", startAt: "2026-07-10T18:00:00.000Z", endAt: null, locationName: null, eventType: "GATHERING" }],
      generatedAt: ""
    });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useParticipatingEvents(30), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/events/participating?days=30");
    expect(result.current.data?.events[0].title).toBe("Foreign BBQ");
  });
});

describe("isForeignEvent", () => {
  const foreign: EventDetailResponse = {
    id: "e1", title: "T", description: null, startAt: "", endAt: null,
    locationName: null, locationAddress: null, locationMapUrl: null,
    eventType: "GATHERING", participants: [], tasks: [], myRsvp: null
  };
  const own: EventDetailResponse = {
    event: { ...mockEvent, familyGroupId: "fam1", createdByPersonId: "p0", description: null, locationAddress: null, locationMapUrl: null, visibility: "FAMILY", isRecurring: false, birthdayPersonId: null, createdAt: "", updatedAt: "" },
    invitations: 0, rsvps: { YES: 0, NO: 0, MAYBE: 0, PENDING: 0 }, eventItems: []
  };
  it("detects the flat foreign shape", () => { expect(isForeignEvent(foreign)).toBe(true); });
  it("detects the wrapped own shape", () => { expect(isForeignEvent(own)).toBe(false); });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=famlink-mobile -- __tests__/hooks/useEvents.test.ts`
Expected: FAIL — exports don't exist.

- [ ] **Step 3: Implement** — in `apps/mobile/hooks/useEvents.ts`, add after the `EventDetail` interface:

```ts
export interface ForeignParticipantEntry {
  displayName: string;
  rsvpStatus: string | null;
}

export interface ForeignTask {
  id: string;
  name: string;
  quantity: string | null;
  notes: string | null;
  status: "UNCLAIMED" | "CLAIMED" | "PROVIDED" | "CANCELLED";
  isOwn: boolean;
}

/**
 * Isolation-safe cross-family event shape (spec §4.1). participants[] is
 * attendees-only { displayName, rsvpStatus } — NEVER widen with personId
 * or family identifiers.
 */
export interface ForeignInvitedEventDTO {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  locationName: string | null;
  locationAddress: string | null;
  locationMapUrl: string | null;
  eventType: string;
  participants: ForeignParticipantEntry[];
  tasks: ForeignTask[];
  myRsvp: "YES" | "NO" | "MAYBE" | null;
}

export type EventDetailResponse = EventDetail | ForeignInvitedEventDTO;

/** The own-event shape has the `event` wrapper; the foreign DTO is flat. */
export function isForeignEvent(d: EventDetailResponse): d is ForeignInvitedEventDTO {
  return !("event" in d);
}

export interface ParticipatingEventSummary {
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  locationName: string | null;
  eventType: string;
}

export function useParticipatingEvents(days = 30) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["participating-events", days],
    queryFn: () =>
      apiFetch<{ events: ParticipatingEventSummary[]; generatedAt: string }>(
        `/api/v1/events/participating?days=${days}`
      ),
  });
}
```

And change `useEvent` to return the union with no retry (Task 8's failure state must surface promptly):

```ts
export function useEvent(eventId: string) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["event", eventId],
    queryFn: () => apiFetch<EventDetailResponse>(`/api/v1/events/${eventId}`),
    retry: false,
  });
}
```

- [ ] **Step 4: Run the mobile hook tests**

Run: `npm test --workspace=famlink-mobile -- __tests__/hooks/useEvents.test.ts`
Expected: PASS (existing + new). Note: `[eventId].tsx` still compiles because it consumes `eventQuery.data` loosely until Task 7 reworks it — if `tsc` complains, that confirms Task 7's branch is needed; do NOT patch the screen here beyond what keeps `npx tsc --noEmit` green (e.g. an explicit `!isForeignEvent(data)` guard is Task 7's job; if needed to stay green temporarily, cast at the destructure site with a `// Task 7 replaces this` comment).

Run: `npx tsc --noEmit` from `apps/mobile`
Expected: clean (or apply the temporary guard noted above).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/hooks/useEvents.ts apps/mobile/__tests__/hooks/useEvents.test.ts
git commit -m "feat: P3-03 mobile foreign DTO types, discriminator, useParticipatingEvents"
```

---

### Task 5: Mobile — items mutation hooks (`useAddItem`, `useDeleteItem`, `useClaimItem` rewrite)

**Files:**
- Modify: `apps/mobile/hooks/useEvents.ts` (replace `useClaimItem`, add `useAddItem`/`useDeleteItem`)
- Test: `apps/mobile/__tests__/hooks/useEvents.test.ts` (replace the old `useClaimItem` describe block)

**Interfaces:**
- Consumes: Task 1's claim endpoint; existing `POST/DELETE /items` routes.
- Produces (Tasks 7–8 depend on these exact names):
  - `useAddItem(eventId)` — `mutate({ name, quantity? })` → POST `/api/v1/events/${eventId}/items` body `{ name, quantity? }`
  - `useDeleteItem(eventId)` — `mutate(itemId)` → DELETE `/api/v1/events/${eventId}/items/${itemId}`
  - `useClaimItem(eventId)` — `mutate(itemId)` → POST `/api/v1/events/${eventId}/items/${itemId}/claim` (NO body, no `currentItems` — the old signature dies)
  - All three invalidate `["event", eventId]` on success.

- [ ] **Step 1: Rewrite the tests** — in `useEvents.test.ts`, DELETE the entire old `describe("useClaimItem")` block (it locks the broken `/potluck` PUT) and append:

```ts
describe("items mutations", () => {
  it("useAddItem POSTs /items with name and quantity", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ id: "i9", name: "Napkins" });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useAddItem("e1"), { wrapper });
    await act(async () => { result.current.mutate({ name: "Napkins", quantity: "2 packs" }); });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/items",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Napkins", quantity: "2 packs" }) })
    );
  });

  it("useDeleteItem DELETEs /items/:itemId", async () => {
    const mockFetch = jest.fn().mockResolvedValue({});
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useDeleteItem("e1"), { wrapper });
    await act(async () => { result.current.mutate("i1"); });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/items/i1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("useClaimItem POSTs /items/:itemId/claim (regression: never the potluck PUT)", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ id: "i1", status: "CLAIMED" });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useClaimItem("e1"), { wrapper });
    await act(async () => { result.current.mutate("i1"); });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/items/i1/claim",
      expect.objectContaining({ method: "POST" })
    );
  });
});
```

Update the import line to `useAddItem, useDeleteItem` alongside the existing imports.

- [ ] **Step 2: Run to verify failure**

Run: `npm test --workspace=famlink-mobile -- __tests__/hooks/useEvents.test.ts`
Expected: FAIL — `useAddItem`/`useDeleteItem` missing; `useClaimItem` signature mismatch.

- [ ] **Step 3: Implement** — in `useEvents.ts`, REPLACE the whole old `useClaimItem` function with:

```ts
export function useAddItem(eventId: string) {
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; quantity?: string }) =>
      apiFetch<SerializedEventItem>(`/api/v1/events/${eventId}/items`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    },
  });
}

export function useDeleteItem(eventId: string) {
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      apiFetch(`/api/v1/events/${eventId}/items/${itemId}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    },
  });
}

export function useClaimItem(eventId: string) {
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      apiFetch(`/api/v1/events/${eventId}/items/${itemId}/claim`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    },
  });
}
```

Note: `[eventId].tsx`'s `handleClaim` still uses the old signature — adjust it minimally so the workspace compiles (`claimMutation.mutate(item.id)` and delete the `currentItems`/`personId` args); Task 7 reworks the screen fully.

- [ ] **Step 4: Verify**

Run: `npm test --workspace=famlink-mobile -- __tests__/hooks/useEvents.test.ts` → PASS.
Run: `npx tsc --noEmit` in `apps/mobile` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/hooks/useEvents.ts apps/mobile/__tests__/hooks/useEvents.test.ts "apps/mobile/app/(tabs)/events/[eventId].tsx"
git commit -m "feat: P3-03 mobile items hooks on /items model; fix broken potluck claim"
```

---

### Task 6: Mobile — events list discovery merge + Guest badge

**Files:**
- Modify: `apps/mobile/app/(tabs)/events/index.tsx`
- Test: `apps/mobile/__tests__/screens/events-index.test.tsx` (new)

**Interfaces:**
- Consumes: `useEvents`, `useParticipatingEvents`, `useMyFamilies` (existing patterns), Task 4's `ParticipatingEventSummary`.
- Produces: the merged-list row type `MergedEventRow = { id, title, startAt, locationName: string | null, isBirthdayEvent?: boolean, isForeign: boolean }` (internal to the screen; no other task consumes it).

- [ ] **Step 1: Write the failing screen test** — create `apps/mobile/__tests__/screens/events-index.test.tsx` (mock hooks like `__tests__/screens/assistant.test.tsx` mocks its hooks; mock `expo-router`'s `useRouter`):

```tsx
import React from "react";
import { render, screen } from "@testing-library/react-native";
import EventsIndex from "../../app/(tabs)/events/index";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("../../hooks/useFamily", () => ({ useMyFamilies: jest.fn() }));
jest.mock("../../hooks/useEvents", () => ({
  useEvents: jest.fn(),
  useParticipatingEvents: jest.fn(),
}));
import { useMyFamilies } from "../../hooks/useFamily";
import { useEvents, useParticipatingEvents } from "../../hooks/useEvents";

const fam = { data: { memberships: [{ familyGroup: { id: "fam1", name: "F" }, roles: [], joinedAt: "" }] }, isLoading: false };
const own = { id: "e1", title: "Family Dinner", startAt: "2026-07-08T18:00:00.000Z", endAt: null, locationName: null, isBirthdayEvent: false };
const foreign = { id: "f1", title: "Neighbor BBQ", startAt: "2026-07-09T18:00:00.000Z", endAt: null, locationName: null, eventType: "GATHERING" };

function setup(ownQ: object, foreignQ: object) {
  (useMyFamilies as jest.Mock).mockReturnValue(fam);
  (useEvents as jest.Mock).mockReturnValue(ownQ);
  (useParticipatingEvents as jest.Mock).mockReturnValue(foreignQ);
  return render(<EventsIndex />);
}

describe("EventsIndex discovery merge", () => {
  it("renders own and foreign events chronologically with a Guest badge on foreign rows", () => {
    setup(
      { data: { events: [own] }, isLoading: false, isError: false },
      { data: { events: [foreign] }, isLoading: false, isError: false }
    );
    expect(screen.getByText("Family Dinner")).toBeTruthy();
    expect(screen.getByText("Neighbor BBQ")).toBeTruthy();
    expect(screen.getAllByText("Guest")).toHaveLength(1);
  });

  it("still renders own events when the participating query fails", () => {
    setup(
      { data: { events: [own] }, isLoading: false, isError: false },
      { data: undefined, isLoading: false, isError: true }
    );
    expect(screen.getByText("Family Dinner")).toBeTruthy();
    expect(screen.queryByText("Guest")).toBeNull();
  });

  it("still renders foreign events when the family events query fails", () => {
    setup(
      { data: undefined, isLoading: false, isError: true },
      { data: { events: [foreign] }, isLoading: false, isError: false }
    );
    expect(screen.getByText("Neighbor BBQ")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test --workspace=famlink-mobile -- __tests__/screens/events-index.test.tsx`
Expected: FAIL — `useParticipatingEvents` not used by the screen / no "Guest" badge.

- [ ] **Step 3: Implement** — rework `apps/mobile/app/(tabs)/events/index.tsx`:

```tsx
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useMyFamilies } from "../../../hooks/useFamily";
import { useEvents, useParticipatingEvents } from "../../../hooks/useEvents";
import type { ReactElement } from "react";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric", minute: "2-digit",
  });
}

interface MergedEventRow {
  id: string;
  title: string;
  startAt: string;
  locationName: string | null;
  isBirthdayEvent: boolean;
  isForeign: boolean;
}

export default function EventsIndex(): ReactElement {
  const router = useRouter();
  const familiesQuery = useMyFamilies();
  const familyId = familiesQuery.data?.memberships[0]?.familyGroup.id ?? null;
  const eventsQuery = useEvents(familyId);
  const participatingQuery = useParticipatingEvents(30);

  if (familiesQuery.isLoading || eventsQuery.isLoading || participatingQuery.isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  // Partial-failure isolation: one failing source must not blank the list.
  if (eventsQuery.isError && participatingQuery.isError) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center px-6">
        <Text className="text-slate-400 text-center">Could not load events.</Text>
      </View>
    );
  }

  const own: MergedEventRow[] = (eventsQuery.data?.events ?? []).map((e) => ({
    id: e.id, title: e.title, startAt: e.startAt,
    locationName: e.locationName, isBirthdayEvent: e.isBirthdayEvent, isForeign: false,
  }));
  const foreign: MergedEventRow[] = (participatingQuery.data?.events ?? []).map((e) => ({
    id: e.id, title: e.title, startAt: e.startAt,
    locationName: e.locationName, isBirthdayEvent: false, isForeign: true,
  }));
  const events = [...own, ...foreign].sort(
    (a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id)
  );

  return (
    <View className="flex-1 bg-slate-950">
      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        ItemSeparatorComponent={() => <View className="h-2" />}
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text className="text-slate-400">No upcoming events</Text>
          </View>
        }
        renderItem={({ item }: { item: MergedEventRow }) => (
          <TouchableOpacity
            onPress={() => router.push(`/(tabs)/events/${item.id}`)}
            className="bg-slate-800 rounded-xl p-4"
          >
            <View className="flex-row justify-between items-start mb-1">
              <Text className="text-slate-50 font-semibold flex-1 mr-2">{item.title}</Text>
              {item.isForeign && (
                <Text className="text-indigo-300 text-xs bg-indigo-950 px-2 py-0.5 rounded">Guest</Text>
              )}
              {item.isBirthdayEvent && (
                <Text className="text-yellow-400 text-xs">🎂 Birthday</Text>
              )}
            </View>
            <Text className="text-slate-400 text-sm">
              {formatDate(item.startAt)} · {formatTime(item.startAt)}
            </Text>
            {item.locationName && (
              <Text className="text-slate-500 text-sm mt-1">{item.locationName}</Text>
            )}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace=famlink-mobile -- __tests__/screens/events-index.test.tsx` → PASS (3).
Run: `npm test --workspace=famlink-mobile` → full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/mobile/app/(tabs)/events/index.tsx" apps/mobile/__tests__/screens/events-index.test.tsx
git commit -m "feat: P3-03 mobile events list merges foreign participations with Guest badge"
```

---

### Task 7: Mobile — event detail split: thin route + `OwnEventDetail` (items migration)

**Files:**
- Create: `apps/mobile/components/events/OwnEventDetail.tsx`
- Modify: `apps/mobile/app/(tabs)/events/[eventId].tsx` (becomes the thin branching route)
- Test: `apps/mobile/__tests__/components/OwnEventDetail.test.tsx` (new)

**Interfaces:**
- Consumes: Task 4's `EventDetail` / `isForeignEvent`; Task 5's `useAddItem`, `useDeleteItem`, `useClaimItem`; existing `useRsvp`, `useMyPerson`, photo hooks.
- Produces: `OwnEventDetail({ eventId, detail }: { eventId: string; detail: EventDetail })` — a client component; the route renders it for the own shape. Task 8 adds the `ForeignEventDetail({ eventId, dto })` sibling and the final route branch.

- [ ] **Step 1: Write the failing component test** — create `apps/mobile/__tests__/components/OwnEventDetail.test.tsx`:

```tsx
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import OwnEventDetail from "../../components/events/OwnEventDetail";
import type { EventDetail } from "../../hooks/useEvents";

const mockMutate = jest.fn();
jest.mock("../../hooks/useEvents", () => ({
  ...jest.requireActual("../../hooks/useEvents"),
  useRsvp: jest.fn(() => ({ mutate: mockMutate, isPending: false })),
  useAddItem: jest.fn(() => ({ mutate: mockMutate, isPending: false })),
  useDeleteItem: jest.fn(() => ({ mutate: mockMutate, isPending: false })),
  useClaimItem: jest.fn(() => ({ mutate: mockMutate, isPending: false })),
}));
jest.mock("../../hooks/useFamily", () => ({
  useMyPerson: jest.fn(() => ({ data: { id: "me1" } })),
}));
jest.mock("../../hooks/usePhotos", () => ({
  useEventPhotos: jest.fn(() => ({ data: [] })),
  useUploadEventPhoto: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
  useDeletePhoto: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
}));

const detail: EventDetail = {
  event: {
    id: "e1", familyGroupId: "fam1", createdByPersonId: "p0", title: "Family Dinner",
    description: null, startAt: "2026-07-08T18:00:00.000Z", endAt: null,
    locationName: null, locationAddress: null, locationMapUrl: null,
    visibility: "FAMILY", isRecurring: false, isBirthdayEvent: false,
    birthdayPersonId: null, createdAt: "", updatedAt: ""
  },
  invitations: 0,
  rsvps: { YES: 1, NO: 0, MAYBE: 0, PENDING: 0 },
  eventItems: [
    { id: "i1", eventId: "e1", createdByPersonId: "me1", assignedToPersonId: null, name: "Salad", quantity: null, notes: null, isChecklistItem: false, status: "UNCLAIMED", visibility: "ALL", createdAt: "", updatedAt: "" },
    { id: "i2", eventId: "e1", createdByPersonId: "p0", assignedToPersonId: null, name: "Drinks", quantity: null, notes: null, isChecklistItem: false, status: "UNCLAIMED", visibility: "ALL", createdAt: "", updatedAt: "" },
  ],
};

describe("OwnEventDetail items", () => {
  beforeEach(() => mockMutate.mockClear());

  it("claims an unclaimed item via the claim mutation with the item id", () => {
    render(<OwnEventDetail eventId="e1" detail={detail} />);
    fireEvent.press(screen.getAllByText("Claim")[0]);
    expect(mockMutate).toHaveBeenCalledWith("i1");
  });

  it("shows Remove only on my own items", () => {
    render(<OwnEventDetail eventId="e1" detail={detail} />);
    // i1 is mine (createdByPersonId me1), i2 is not
    expect(screen.getAllByText("Remove")).toHaveLength(1);
  });

  it("adds an item through the add form", () => {
    render(<OwnEventDetail eventId="e1" detail={detail} />);
    fireEvent.changeText(screen.getByPlaceholderText("Add something to bring…"), "Napkins");
    fireEvent.press(screen.getByText("Add"));
    expect(mockMutate).toHaveBeenCalledWith({ name: "Napkins" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test --workspace=famlink-mobile -- __tests__/components/OwnEventDetail.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement.** Create `apps/mobile/components/events/OwnEventDetail.tsx` by MOVING the body of today's `[eventId].tsx` into it with these changes (keep the photos section and RSVP row exactly as they are today):

```tsx
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Image, FlatList, Alert
} from "react-native";
import { useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { useRsvp, useAddItem, useDeleteItem, useClaimItem } from "../../hooks/useEvents";
import { useMyPerson } from "../../hooks/useFamily";
import { useEventPhotos, useUploadEventPhoto, useDeletePhoto } from "../../hooks/usePhotos";
import type { EventDetail, SerializedEventItem } from "../../hooks/useEvents";
import type { ReactElement } from "react";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit"
  });
}

export default function OwnEventDetail({ eventId, detail }: { eventId: string; detail: EventDetail }): ReactElement {
  const { event, rsvps, eventItems } = detail;
  const myPersonQuery = useMyPerson();
  const myPersonId = myPersonQuery.data?.id ?? null;
  const rsvpMutation = useRsvp(eventId);
  const addItemMutation = useAddItem(eventId);
  const deleteItemMutation = useDeleteItem(eventId);
  const claimMutation = useClaimItem(eventId);
  const photosQuery = useEventPhotos(eventId);
  const uploadPhotoMutation = useUploadEventPhoto(eventId);
  const deletePhotoMutation = useDeletePhoto(eventId);
  const [newItemName, setNewItemName] = useState("");

  // ... keep today's handleAddPhoto + photos rendering verbatim ...

  function handleAddItem() {
    const name = newItemName.trim();
    if (!name || addItemMutation.isPending) return;
    addItemMutation.mutate({ name });
    setNewItemName("");
  }

  function handleRemoveItem(item: SerializedEventItem) {
    Alert.alert("Remove item?", item.name, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => deleteItemMutation.mutate(item.id) }
    ]);
  }

  // items section replaces the old claim-only block:
  // - each UNCLAIMED item shows a "Claim" button → claimMutation.mutate(item.id), disabled while isPending
  // - items where item.createdByPersonId === myPersonId show a "Remove" text button → handleRemoveItem
  // - below the list: <TextInput placeholder="Add something to bring…" value={newItemName}
  //     onChangeText={setNewItemName} /> and an "Add" button → handleAddItem, disabled while isPending
  // Full JSX: copy today's items map, change the Claim onPress to claimMutation.mutate(item.id),
  // add the Remove button gated by createdByPersonId === myPersonId, and append the add-form row.
  // RSVP + header + photos sections are copied verbatim from today's screen.
```

The complete items JSX (drop-in replacement for the old `{/* EventItems */}` block):

```tsx
      <View className="mb-8">
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">What to bring</Text>
        {eventItems.map((item) => (
          <View
            key={item.id}
            className="bg-slate-800 rounded-xl px-4 py-3 mb-2 flex-row items-center justify-between"
          >
            <View className="flex-1 mr-3">
              <Text className="text-slate-50 font-medium">{item.name}</Text>
              {item.quantity && <Text className="text-slate-400 text-sm">{item.quantity}</Text>}
              {item.assignedToPersonId && (
                <Text className="text-green-400 text-xs mt-1">Claimed</Text>
              )}
            </View>
            {item.status === "UNCLAIMED" && (
              <TouchableOpacity
                onPress={() => claimMutation.mutate(item.id)}
                disabled={claimMutation.isPending}
                style={{ opacity: claimMutation.isPending ? 0.5 : 1, backgroundColor: "#4f46e5", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
              >
                <Text style={{ color: "#fff", fontSize: 14, fontWeight: "500" }}>Claim</Text>
              </TouchableOpacity>
            )}
            {item.createdByPersonId === myPersonId && (
              <TouchableOpacity onPress={() => handleRemoveItem(item)} disabled={deleteItemMutation.isPending} style={{ marginLeft: 8 }}>
                <Text className="text-red-400 text-sm">Remove</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        <View className="flex-row items-center mt-2">
          <TextInput
            className="flex-1 bg-slate-800 text-slate-50 rounded-xl px-4 py-2 mr-2"
            placeholder="Add something to bring…"
            placeholderTextColor="#64748b"
            value={newItemName}
            onChangeText={setNewItemName}
          />
          <TouchableOpacity
            onPress={handleAddItem}
            disabled={addItemMutation.isPending}
            style={{ opacity: addItemMutation.isPending ? 0.5 : 1, backgroundColor: "#4f46e5", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 }}
          >
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "500" }}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>
```

(Remove the old `eventItems.length > 0 &&` gate — the add form must render even with zero items.)

Then shrink `apps/mobile/app/(tabs)/events/[eventId].tsx` to the thin route (Task 8 adds the foreign branch; until then render own-or-nothing):

```tsx
import { View, Text, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useEvent, isForeignEvent } from "../../../hooks/useEvents";
import OwnEventDetail from "../../../components/events/OwnEventDetail";
import type { ReactElement } from "react";

export default function EventDetailRoute(): ReactElement {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const eventQuery = useEvent(eventId);

  if (eventQuery.isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }
  // isError FIRST — never render cached data after an authoritative error
  if (eventQuery.isError || !eventQuery.data) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center px-6">
        <Text className="text-slate-400 text-center">This event is no longer available.</Text>
      </View>
    );
  }
  if (isForeignEvent(eventQuery.data)) {
    // Task 8 replaces this with <ForeignEventDetail eventId={eventId} dto={eventQuery.data} />
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center px-6">
        <Text className="text-slate-400 text-center">This event is no longer available.</Text>
      </View>
    );
  }
  return <OwnEventDetail eventId={eventId} detail={eventQuery.data} />;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --workspace=famlink-mobile` → full suite PASS.
Run: `npx tsc --noEmit` in `apps/mobile` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/events/OwnEventDetail.tsx "apps/mobile/app/(tabs)/events/[eventId].tsx" apps/mobile/__tests__/components/OwnEventDetail.test.tsx
git commit -m "feat: P3-03 mobile event detail split; own-event items on /items model"
```

---

### Task 8: Mobile — `ForeignEventDetail` + route branch + stale-cache suppression

**Files:**
- Create: `apps/mobile/components/events/ForeignEventDetail.tsx`
- Modify: `apps/mobile/app/(tabs)/events/[eventId].tsx` (wire the foreign branch + cache removal on error)
- Test: `apps/mobile/__tests__/components/ForeignEventDetail.test.tsx` (new), plus a route-level stale-cache test in `apps/mobile/__tests__/screens/event-detail-route.test.tsx` (new)

**Interfaces:**
- Consumes: Task 4's `ForeignInvitedEventDTO`/`ForeignTask`, Task 5's `useAddItem`/`useDeleteItem`/`useClaimItem`, existing `useRsvp`.
- Produces: `ForeignEventDetail({ eventId, dto }: { eventId: string; dto: ForeignInvitedEventDTO })`. Nothing downstream consumes it (terminal UI component).

- [ ] **Step 1: Write the failing tests.** Create `apps/mobile/__tests__/components/ForeignEventDetail.test.tsx`:

```tsx
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import ForeignEventDetail from "../../components/events/ForeignEventDetail";
import type { ForeignInvitedEventDTO } from "../../hooks/useEvents";

const mockRsvp = jest.fn();
const mockClaim = jest.fn();
const mockAdd = jest.fn();
const mockDelete = jest.fn();
jest.mock("../../hooks/useEvents", () => ({
  ...jest.requireActual("../../hooks/useEvents"),
  useRsvp: jest.fn(() => ({ mutate: mockRsvp, isPending: false })),
  useAddItem: jest.fn(() => ({ mutate: mockAdd, isPending: false })),
  useDeleteItem: jest.fn(() => ({ mutate: mockDelete, isPending: false })),
  useClaimItem: jest.fn(() => ({ mutate: mockClaim, isPending: false })),
}));

const dto: ForeignInvitedEventDTO = {
  id: "f1", title: "Neighbor BBQ", description: "Bring a chair",
  startAt: "2026-07-09T18:00:00.000Z", endAt: null,
  locationName: "Park", locationAddress: null, locationMapUrl: null,
  eventType: "GATHERING",
  participants: [
    { displayName: "Dave", rsvpStatus: "YES" },
    { displayName: "Sara", rsvpStatus: null },
  ],
  tasks: [
    { id: "t1", name: "Ice", quantity: null, notes: null, status: "UNCLAIMED", isOwn: false },
    { id: "t2", name: "Buns", quantity: null, notes: null, status: "UNCLAIMED", isOwn: true },
  ],
  myRsvp: "YES",
};

describe("ForeignEventDetail", () => {
  beforeEach(() => { mockRsvp.mockClear(); mockClaim.mockClear(); mockAdd.mockClear(); mockDelete.mockClear(); });

  it("renders DTO fields, attendees, and NO owner affordances", () => {
    render(<ForeignEventDetail eventId="f1" dto={dto} />);
    expect(screen.getByText("Neighbor BBQ")).toBeTruthy();
    expect(screen.getByText("Dave")).toBeTruthy();
    expect(screen.getByText("Sara")).toBeTruthy();
    // no owner-only surfaces
    expect(screen.queryByText(/photo/i)).toBeNull();
    expect(screen.queryByText(/invite/i)).toBeNull();
    expect(screen.queryByText(/pending/i)).toBeNull();
  });

  it("marks the current RSVP from myRsvp", () => {
    render(<ForeignEventDetail eventId="f1" dto={dto} />);
    expect(screen.getByTestId("rsvp-YES-selected")).toBeTruthy();
  });

  it("RSVP buttons call the rsvp mutation", () => {
    render(<ForeignEventDetail eventId="f1" dto={dto} />);
    fireEvent.press(screen.getByText("? Maybe"));
    expect(mockRsvp).toHaveBeenCalledWith("MAYBE");
  });

  it("delete-own only on isOwn tasks; claim on unclaimed; add form works", () => {
    render(<ForeignEventDetail eventId="f1" dto={dto} />);
    expect(screen.getAllByText("Remove")).toHaveLength(1); // only t2 (isOwn)
    fireEvent.press(screen.getAllByText("Claim")[0]);
    expect(mockClaim).toHaveBeenCalledWith("t1");
    fireEvent.changeText(screen.getByPlaceholderText("Add something to bring…"), "Chips");
    fireEvent.press(screen.getByText("Add"));
    expect(mockAdd).toHaveBeenCalledWith({ name: "Chips" });
  });
});
```

Create `apps/mobile/__tests__/screens/event-detail-route.test.tsx` (stale-cache suppression — error wins even when cached data exists):

```tsx
import React from "react";
import { render, screen } from "@testing-library/react-native";
import EventDetailRoute from "../../app/(tabs)/events/[eventId]";

jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ eventId: "f1" }) }));
jest.mock("../../hooks/useEvents", () => ({
  ...jest.requireActual("../../hooks/useEvents"),
  useEvent: jest.fn(),
}));
jest.mock("../../components/events/OwnEventDetail", () => jest.fn(() => null));
jest.mock("../../components/events/ForeignEventDetail", () => jest.fn(() => null));
import { useEvent } from "../../hooks/useEvents";

describe("EventDetailRoute stale-cache suppression", () => {
  it("renders the unavailable state on error even when cached data exists", () => {
    (useEvent as jest.Mock).mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error("API 403: Not authorized to view this event"),
      data: { id: "f1", title: "Stale Cached BBQ", participants: [], tasks: [], myRsvp: null },
    });
    render(<EventDetailRoute />);
    expect(screen.getByText("This event is no longer available.")).toBeTruthy();
    expect(screen.queryByText("Stale Cached BBQ")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test --workspace=famlink-mobile -- __tests__/components/ForeignEventDetail.test.tsx __tests__/screens/event-detail-route.test.tsx`
Expected: FAIL — component missing; route may pass the stale test already (isError-first was built in Task 7 — if it passes, that's fine, keep it as a regression lock).

- [ ] **Step 3: Implement.** Create `apps/mobile/components/events/ForeignEventDetail.tsx`:

```tsx
import { View, Text, ScrollView, TouchableOpacity, TextInput, Linking, Alert } from "react-native";
import { useState } from "react";
import { useRsvp, useAddItem, useDeleteItem, useClaimItem } from "../../hooks/useEvents";
import type { ForeignInvitedEventDTO, ForeignTask } from "../../hooks/useEvents";
import type { ReactElement } from "react";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit"
  });
}

export default function ForeignEventDetail({ eventId, dto }: { eventId: string; dto: ForeignInvitedEventDTO }): ReactElement {
  const rsvpMutation = useRsvp(eventId);
  const addItemMutation = useAddItem(eventId);
  const deleteItemMutation = useDeleteItem(eventId);
  const claimMutation = useClaimItem(eventId);
  const [newItemName, setNewItemName] = useState("");

  function handleAddItem() {
    const name = newItemName.trim();
    if (!name || addItemMutation.isPending) return;
    addItemMutation.mutate({ name });
    setNewItemName("");
  }

  function handleRemoveTask(task: ForeignTask) {
    Alert.alert("Remove item?", task.name, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => deleteItemMutation.mutate(task.id) }
    ]);
  }

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 24 }}>
      <View className="flex-row items-center mb-2">
        <Text className="text-slate-50 text-xl font-bold flex-1">{dto.title}</Text>
        <Text className="text-indigo-300 text-xs bg-indigo-950 px-2 py-0.5 rounded">Guest</Text>
      </View>
      <Text className="text-slate-400 mb-2">{formatDateTime(dto.startAt)}</Text>
      {dto.locationName && (
        <TouchableOpacity
          disabled={!dto.locationMapUrl}
          onPress={() => dto.locationMapUrl && void Linking.openURL(dto.locationMapUrl)}
        >
          <Text className="text-slate-400 mb-2">📍 {dto.locationName}</Text>
        </TouchableOpacity>
      )}
      {dto.description && <Text className="text-slate-300 mb-6">{dto.description}</Text>}

      {/* RSVP with myRsvp highlight */}
      <View className="mb-8">
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">Your RSVP</Text>
        <View className="flex-row gap-3">
          {(["YES", "NO", "MAYBE"] as const).map((status) => {
            const selected = dto.myRsvp === status;
            return (
              <TouchableOpacity
                key={status}
                testID={selected ? `rsvp-${status}-selected` : `rsvp-${status}`}
                onPress={() => rsvpMutation.mutate(status)}
                disabled={rsvpMutation.isPending}
                style={{
                  opacity: rsvpMutation.isPending ? 0.5 : 1,
                  backgroundColor:
                    status === "YES" ? "#15803d20" : status === "NO" ? "#b91c1c20" : "#92400e20",
                  flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center",
                  borderWidth: selected ? 2 : 1,
                  borderColor: selected ? "#6366f1" : "#334155"
                }}
              >
                <Text
                  className={`font-semibold text-sm ${
                    status === "YES" ? "text-green-400" : status === "NO" ? "text-red-400" : "text-amber-400"
                  }`}
                >
                  {status === "YES" ? "✓ Yes" : status === "NO" ? "✗ No" : "? Maybe"}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Attendees — displayName only (isolation contract) */}
      <View className="mb-8">
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">Who's coming</Text>
        {dto.participants.map((p, i) => (
          <View key={`${p.displayName}-${i}`} className="flex-row justify-between py-1">
            <Text className="text-slate-50">{p.displayName}</Text>
            <Text className="text-slate-500 text-sm">{p.rsvpStatus ?? "—"}</Text>
          </View>
        ))}
      </View>

      {/* Tasks: add / claim / delete-own */}
      <View className="mb-8">
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">What to bring</Text>
        {dto.tasks.map((task) => (
          <View key={task.id} className="bg-slate-800 rounded-xl px-4 py-3 mb-2 flex-row items-center justify-between">
            <View className="flex-1 mr-3">
              <Text className="text-slate-50 font-medium">{task.name}</Text>
              {task.quantity && <Text className="text-slate-400 text-sm">{task.quantity}</Text>}
              {task.status !== "UNCLAIMED" && (
                <Text className="text-green-400 text-xs mt-1">Claimed</Text>
              )}
            </View>
            {task.status === "UNCLAIMED" && (
              <TouchableOpacity
                onPress={() => claimMutation.mutate(task.id)}
                disabled={claimMutation.isPending}
                style={{ opacity: claimMutation.isPending ? 0.5 : 1, backgroundColor: "#4f46e5", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
              >
                <Text style={{ color: "#fff", fontSize: 14, fontWeight: "500" }}>Claim</Text>
              </TouchableOpacity>
            )}
            {task.isOwn && (
              <TouchableOpacity onPress={() => handleRemoveTask(task)} disabled={deleteItemMutation.isPending} style={{ marginLeft: 8 }}>
                <Text className="text-red-400 text-sm">Remove</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        <View className="flex-row items-center mt-2">
          <TextInput
            className="flex-1 bg-slate-800 text-slate-50 rounded-xl px-4 py-2 mr-2"
            placeholder="Add something to bring…"
            placeholderTextColor="#64748b"
            value={newItemName}
            onChangeText={setNewItemName}
          />
          <TouchableOpacity
            onPress={handleAddItem}
            disabled={addItemMutation.isPending}
            style={{ opacity: addItemMutation.isPending ? 0.5 : 1, backgroundColor: "#4f46e5", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 }}
          >
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "500" }}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}
```

Wire the route branch in `[eventId].tsx` — replace the Task 7 placeholder foreign branch with:

```tsx
  if (isForeignEvent(eventQuery.data)) {
    return <ForeignEventDetail eventId={eventId} dto={eventQuery.data} />;
  }
```

(add `import ForeignEventDetail from "../../../components/events/ForeignEventDetail";`)

And add cache removal on authoritative error (in the route component, before the early returns):

```tsx
  const queryClient = useQueryClient();
  const errMsg = eventQuery.error instanceof Error ? eventQuery.error.message : "";
  const isGone = /^API (403|404)/.test(errMsg);
  useEffect(() => {
    if (eventQuery.isError && isGone) {
      queryClient.removeQueries({ queryKey: ["event", eventId] });
    }
  }, [eventQuery.isError, isGone, eventId, queryClient]);
```

(imports: `useEffect` from `react`, `useQueryClient` from `@tanstack/react-query`; hooks must run before the conditional returns.)

- [ ] **Step 4: Run tests**

Run: `npm test --workspace=famlink-mobile` → full suite PASS.
Run: `npx tsc --noEmit` in `apps/mobile` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/events/ForeignEventDetail.tsx "apps/mobile/app/(tabs)/events/[eventId].tsx" apps/mobile/__tests__/components/ForeignEventDetail.test.tsx apps/mobile/__tests__/screens/event-detail-route.test.tsx
git commit -m "feat: P3-03 mobile foreign event viewer with RSVP, tasks, stale-cache suppression"
```

---

### Task 9: CI — mobile job + mobile `type-check` script

**Files:**
- Modify: `apps/mobile/package.json` (add `type-check` script)
- Modify: `.github/workflows/ci.yml` (add `mobile` job; update the stale comment)

**Interfaces:**
- Consumes: nothing from other tasks (but must land after them so the suite it runs is green).
- Produces: CI enforcement for the whole mobile suite — PR 2 inherits it with no further CI change.

- [ ] **Step 1: Add the script** — in `apps/mobile/package.json` `scripts`, after `"lint"`:

```json
    "type-check": "tsc --noEmit",
```

- [ ] **Step 2: Verify all three commands pass locally** (this is the "failing test" equivalent — if type-check fails on pre-existing errors, STOP and report; do not fix unrelated type errors silently)

Run from repo root:
```bash
npm run lint --workspace=famlink-mobile
npm run type-check --workspace=famlink-mobile
npm test --workspace=famlink-mobile
```
Expected: all PASS.

- [ ] **Step 3: Add the CI job** — in `.github/workflows/ci.yml`, add after the `test` job (same indentation level), and update the `test` job's comment line `# (the generated client is gitignored). Mobile (jest-expo) is not yet run in CI.` to `# (the generated client is gitignored). Mobile runs in its own job below.`:

```yaml
  mobile:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Mobile lint
        run: npm run lint --workspace=famlink-mobile

      - name: Mobile type-check
        run: npm run type-check --workspace=famlink-mobile

      # No coverage threshold in CI yet (no mobile coverage baseline; spec Q5-A)
      - name: Mobile tests
        run: npm test --workspace=famlink-mobile
```

Also add `mobile` to the `build` job's `needs:` list:

```yaml
    needs:
      - lint-and-typecheck
      - test
      - mobile
```

- [ ] **Step 4: Validate the workflow YAML**

Run: `npx yaml-lint .github/workflows/ci.yml` if available, else `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/ci.yml','utf8')); console.log('yaml ok')"`
Expected: parses cleanly.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/package.json .github/workflows/ci.yml
git commit -m "ci: P3-03 run mobile lint/type-check/jest in CI"
```

---

### Task 10: Final verification

**Files:** none (verification only; fix-forward anything found and commit fixes with `fix: P3-03 ...`).

- [ ] **Step 1: Full API suite** — `npm test --workspace=@famlink/api -- --run` → ALL PASS (baseline was 415; expect 415 + new).
- [ ] **Step 2: Full web suite with coverage gate** — `npm test --workspace=famlink-web -- --coverage` → ALL PASS, coverage ≥ 80% (web untouched; this guards against accidental cross-workspace damage).
- [ ] **Step 3: Full mobile suite** — `npm test --workspace=famlink-mobile` → ALL PASS.
- [ ] **Step 4: Repo-root type-check** — `npm run type-check` → clean.
- [ ] **Step 5: Repo-root lint** — `npm run lint` → 0 errors (pre-existing warnings only).
- [ ] **Step 6: Whitespace check** — `git diff main --check` → clean.
- [ ] **Step 7: GitNexus regression scope** — run `detect_changes` comparing against `main`; confirm affected symbols/flows are limited to the events routes, eventAccess, mobile hooks/screens, and CI file. Report anything unexpected.
- [ ] **Step 8: Report** the verification table (suite counts, lint/type-check status) for the whole-branch review gate.

---

## Self-Review (completed at write time)

- **Spec coverage:** §3.1→Task 3, §3.2→Task 2, §3.3→Task 1, §4.1→Tasks 4–5, §4.2→Tasks 6–8, §6 invariants→embedded in Tasks 3/4/8 tests, §7 API/hooks/screens tests→Tasks 1–8, §7 CI→Task 9, verification→Task 10. PR 2 sections (§5) intentionally not covered here.
- **Placeholder scan:** Task 7 Step 3 includes two comment-guided regions ("keep today's handleAddPhoto + photos rendering verbatim", "copy today's items map") — acceptable because the source content exists verbatim in the current `[eventId].tsx` the implementer is editing, and the full replacement items JSX is given.
- **Type consistency:** `useClaimItem.mutate(itemId: string)` used identically in Tasks 5/7/8; `ForeignTask.isOwn` matches API `foreignItemShape`; `myRsvp` field name identical in Tasks 2/4/8; `useParticipatingEvents` response `{ events, generatedAt }` matches Task 3's route.
