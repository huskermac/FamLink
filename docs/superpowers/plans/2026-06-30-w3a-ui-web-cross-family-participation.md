# W3a-UI-web — Cross-Family Event Participation UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the merged W3a-API usable on the web client — invite cross-family people with a role, let them accept/decline/revive participation and contribute tasks, let owners manage participants — and close the day-1 guest-delivery gap.

**Architecture:** Five small additive/surgical API changes on the existing Express + Prisma router (`apps/api/src/routes/events.ts`, `apps/api/src/lib/notificationService.ts`), then web client functions and four UI surfaces in the Next.js App Router app. The backend already has the participation grant, accept/decline, revoke/role, ownership-scoped per-item tasks, the `famlinkUser` invite path, and the isolation-safe `ForeignInvitedEventDTO`.

**Tech Stack:** Express, Prisma/Postgres, Zod, Resend (email), Twilio (SMS), Clerk auth, Next.js App Router, React, TanStack Query, vitest + supertest (API), vitest + @testing-library/react (web).

**Spec:** `docs/superpowers/specs/2026-06-25-w3a-ui-web-cross-family-participation-design.md`

> **Round-2 plan (2026-06-30):** revised after a Codex plan-gate review. Fixes: `/participants` gated to owning members only (a cross-family EVENT_ADMIN must NOT read the roster); `previewParticipation` is authenticated with a relative path (matches `apiFetch`, which requires `getToken`); preview HTTP contract aligned (400 absent token / 403 not-yours; ACTIVE returns `{state,eventId}` only); a new Task 5 adds an isolation-safe `isOwn` flag so the foreign viewer can scope edit/delete-own (foreignItemShape strips person ids); admin detection reads the `roles[]` array `getMyFamilies` actually returns, keyed to the **event's** family (not `data[0]`).

## Global Constraints

- **Commit format:** `feat: P3-03 <short description>` (or `fix:` / `chore:`). Phase tag **P3-03**.
- **Per-task verification (all three):** from the touched workspace run the task's tests, then `npm run type-check`, then `npm run lint`. Lint errors fail CI — never skip lint.
- **Cross-tenant isolation (hard invariant):** never leak another family's name, roster, events, or internal **person ids** across the `FamilyGroup` boundary. The participant viewer only consumes the foreign DTO (no person ids — only an `isOwn` boolean); `/participants` is **owning members only**; preview returns no family identifiers.
- **Guest message copy:** the guest invitation email/SMS body and URL contain **only** event title, start time, and the `/rsvp/{token}` link — no family name, roster, inviter family, participant list, or internal IDs.
- **Revival never overrides admin revocation:** the accept mutation matches invitation status ∈ {PENDING, DECLINED} only — never ACCEPTED — so an admin-revoked participant (invitation ACCEPTED, grant REVOKED) cannot self-rejoin via the link.
- **`invitedByName`** exposed to an invitee = the inviter's `preferredName ?? firstName` only, never a family name.
- **Admin detection (web):** `getMyFamilies()` returns `{ familyGroup, role, roles: string[], joinedAt }[]`. The viewer is an admin of an event when the membership whose `familyGroup.id === event.familyGroupId` has `roles` containing `"ADMIN"` or `"ORGANIZER"`. Always key off the **event's** family, never `data[0]`.
- **No invitees array cap** this cycle (deliberate — see spec §2/§6).
- Tests run: API from `apps/api` via `npx vitest run <path>`; web from `apps/web` via `npx vitest run <path>`.

---

## File Structure

**API (`apps/api/src/`):**
- `lib/notificationService.ts` — MODIFY: add exported `buildGuestInvitationMessage()` (pure) + `NotificationService.sendGuestInvitation()`.
- `routes/events.ts` — MODIFY: guest delivery in the `guest` branch of `POST /:eventId/invitations`; widen `participation/accept`; add `GET /participation/preview`; add `GET /:eventId/participants`; extend `foreignItemShape` with `isOwn`.
- `__tests__/lib/guestInvitationMessage.test.ts` — NEW.
- `__tests__/routes/events.test.ts` — MODIFY: guest delivery, accept revival, preview, participants list, foreign-item `isOwn`.

**Web (`apps/web/`):**
- `lib/api/family.ts` — MODIFY: add `roles: string[]` to `FamilyMembership`.
- `lib/api/events.ts` — MODIFY: tagged `InviteeEntry`; `ForeignEventItem`/`ForeignEventDTO`; participation/participant/item client fns; type guard.
- `app/(protected)/events/[eventId]/invite/page.tsx` — MODIFY.
- `app/events/accept/page.tsx` + `AcceptClient.tsx` — NEW.
- `components/events/ForeignEventDetail.tsx` — NEW.
- `components/events/ParticipantsSection.tsx` — NEW.
- `app/(protected)/events/[eventId]/page.tsx` — MODIFY.
- Co-located `__tests__/` for each new/changed web unit.

**Task order & dependencies:** Tasks 1–5 (API) are independent of each other; Task 1 is the day-1 priority. Task 6 (client) consumes API shapes from 1–5. Tasks 7–10 (UI) consume Task 6.

---

## Task 1: Guest invitation delivery (day-1, non-negotiable)

**Files:**
- Modify: `apps/api/src/lib/notificationService.ts`
- Create: `apps/api/src/__tests__/lib/guestInvitationMessage.test.ts`
- Modify: `apps/api/src/routes/events.ts` (guest branch of `POST /:eventId/invitations`, ~lines 595–627 + post-transaction notify block ~654–666)
- Modify: `apps/api/src/__tests__/routes/events.test.ts`

**Interfaces:**
- Produces:
  - `buildGuestInvitationMessage(opts: { eventTitle: string; startAt: Date; rsvpUrl: string }): { subject: string; body: string }`
  - `NotificationService.sendGuestInvitation(opts: { invitationId: string; email?: string | null; phone?: string | null; message: { subject: string; body: string } }): Promise<void>`

- [ ] **Step 1: Write the failing pure-copy test**

Create `apps/api/src/__tests__/lib/guestInvitationMessage.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildGuestInvitationMessage } from "../../lib/notificationService";

describe("buildGuestInvitationMessage", () => {
  const startAt = new Date("2026-07-04T17:00:00Z");
  const rsvpUrl = "https://app.famlink.test/rsvp/tok_abc123";

  it("emits exactly title + time + link (subject and body)", () => {
    const { subject, body } = buildGuestInvitationMessage({ eventTitle: "Soccer Finals", startAt, rsvpUrl });
    const when = startAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    expect(subject).toBe("You're invited: Soccer Finals");
    expect(body).toBe(`You're invited to Soccer Finals on ${when}. RSVP here: ${rsvpUrl}`);
  });

  it("includes the title and the RSVP link", () => {
    const { body } = buildGuestInvitationMessage({ eventTitle: "Soccer Finals", startAt, rsvpUrl });
    expect(body).toContain("Soccer Finals");
    expect(body).toContain(rsvpUrl);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `apps/api`): `npx vitest run src/__tests__/lib/guestInvitationMessage.test.ts`
Expected: FAIL — `buildGuestInvitationMessage` is not exported.

- [ ] **Step 3: Add `buildGuestInvitationMessage` + `sendGuestInvitation`**

In `apps/api/src/lib/notificationService.ts`, add after `truncateNotificationSmsBody` (~line 57, before `export class NotificationService`):

```typescript
export interface GuestInvitationMessage {
  subject: string;
  body: string;
}

/**
 * Isolation-safe guest invitation copy: ONLY event title, start time, and the
 * RSVP link. Never accepts (and so never emits) family name, roster, or ids.
 */
export function buildGuestInvitationMessage(opts: {
  eventTitle: string;
  startAt: Date;
  rsvpUrl: string;
}): GuestInvitationMessage {
  const when = opts.startAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  return {
    subject: `You're invited: ${opts.eventTitle}`,
    body: `You're invited to ${opts.eventTitle} on ${when}. RSVP here: ${opts.rsvpUrl}`
  };
}
```

Add this public method inside the `NotificationService` class (after `sendSms`, ~line 112):

```typescript
  /**
   * Direct guest delivery: emails/texts a contact-only invitee the RSVP link.
   * Bypasses the person-preference path (guests have no deliverable Person
   * contact / prefs). Each channel is independently non-fatal and logged.
   */
  async sendGuestInvitation(opts: {
    invitationId: string;
    email?: string | null;
    phone?: string | null;
    message: GuestInvitationMessage;
  }): Promise<void> {
    if (opts.email) {
      let success = false;
      let error: string | undefined;
      try {
        success = await this.sendEmail(opts.email, opts.message.subject, opts.message.body);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      console.info(JSON.stringify({ event: "guest_invitation_delivery", invitationId: opts.invitationId, channel: "EMAIL", success, ...(error ? { error } : {}) }));
    }
    if (opts.phone) {
      let success = false;
      let error: string | undefined;
      try {
        success = await this.sendSms(opts.phone, opts.message.body);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      console.info(JSON.stringify({ event: "guest_invitation_delivery", invitationId: opts.invitationId, channel: "SMS", success, ...(error ? { error } : {}) }));
    }
  }
```

- [ ] **Step 4: Run the pure test to verify it passes**

Run (from `apps/api`): `npx vitest run src/__tests__/lib/guestInvitationMessage.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing route test**

In `apps/api/src/__tests__/routes/events.test.ts`, add (import `NotificationService` at the top of the file if not already imported):

```typescript
import { NotificationService } from "../../lib/notificationService";

describe("POST /api/v1/events/:eventId/invitations — guest delivery (P3-03 W3a-UI)", () => {
  it("invokes sendGuestInvitation with the rsvp link + title and no family name; send failure is non-fatal", async () => {
    // Each channel inside sendGuestInvitation catches its own error, so we make the
    // whole method throw to prove the route-level call site is also non-fatal.
    const spy = vi.spyOn(NotificationService.prototype, "sendGuestInvitation").mockRejectedValue(new Error("boom"));

    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id); // family name "Test Family"
    const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Picnic" });
    await db.event.update({ where: { id: event.id }, data: { eventVisibility: "OPEN" } });

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app)
      .post(`/api/v1/events/${event.id}/invitations`)
      .set("Authorization", "Bearer mock")
      .send({ invitees: [{ kind: "guest", guestEmail: "ext@example.com", guestName: "Ext Guest" }] });

    expect(res.status).toBe(201);
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0];
    expect(arg.email).toBe("ext@example.com");
    expect(arg.message.body).toContain("Picnic");
    expect(arg.message.body).toMatch(/\/rsvp\//);
    expect(`${arg.message.subject}\n${arg.message.body}`).not.toContain("Test Family");

    spy.mockRestore();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run (from `apps/api`): `npx vitest run src/__tests__/routes/events.test.ts -t "guest delivery"`
Expected: FAIL — `sendGuestInvitation` is never called.

- [ ] **Step 7: Wire guest delivery into the invite handler**

In `apps/api/src/routes/events.ts`, in `POST /:eventId/invitations`:

1. Near `famlinkUserInvites` (~line 574) add:

```typescript
  const guestInvites: Array<{ invitationId: string; guestToken: string; email: string | null; phone: string | null }> = [];
```

2. In the `guest` branch, after the existing `createdInvitations.push(created);` (~line 626) add:

```typescript
          guestInvites.push({ invitationId: created.id, guestToken: created.guestToken!, email: invitee.guestEmail ?? null, phone: invitee.guestPhone ?? null });
```

3. After the `famlinkUserInvites` notify block (~line 666, before `res.status(201)`) add:

```typescript
  if (guestInvites.length > 0) {
    const guestNotifier = new NotificationService();
    for (const g of guestInvites) {
      const message = buildGuestInvitationMessage({
        eventTitle: event.title,
        startAt: event.startAt,
        rsvpUrl: `${env.WEB_APP_URL}/rsvp/${g.guestToken}`
      });
      guestNotifier
        .sendGuestInvitation({ invitationId: g.invitationId, email: g.email, phone: g.phone, message })
        .catch(() => { /* non-fatal */ });
    }
  }
```

4. Extend the existing import:

```typescript
import { NotificationService, buildGuestInvitationMessage } from "../lib/notificationService";
```

(`env` is already imported — it is used for `env.WEB_APP_URL` in the famlinkUser block.)

- [ ] **Step 8: Run the route test to verify it passes**

Run (from `apps/api`): `npx vitest run src/__tests__/routes/events.test.ts -t "guest delivery"`
Expected: PASS.

- [ ] **Step 9: Full verification + commit**

Run (from `apps/api`): `npx vitest run src/__tests__/lib/guestInvitationMessage.test.ts src/__tests__/routes/events.test.ts` then `npm run type-check` then `npm run lint`.

```bash
git add apps/api/src/lib/notificationService.ts apps/api/src/routes/events.ts apps/api/src/__tests__/lib/guestInvitationMessage.test.ts apps/api/src/__tests__/routes/events.test.ts
git commit -m "feat: P3-03 deliver guest invitations via direct email/SMS"
```

---

## Task 2: Widen participation/accept to revive a declined invite

**Files:**
- Modify: `apps/api/src/routes/events.ts` (`POST /:eventId/participation/accept`, ~lines 908–932)
- Modify: `apps/api/src/__tests__/routes/events.test.ts`

**Interfaces:**
- Produces: no signature change; accept now matches invitation status ∈ {PENDING, DECLINED}.

- [ ] **Step 1: Write the failing tests**

Add to the accept describe block in `apps/api/src/__tests__/routes/events.test.ts`:

```typescript
it("accept: revives a previously DECLINED invitation into an ACTIVE grant", async () => {
  const admin = await seedTestPerson();
  const { familyGroup } = await seedTestFamily(admin.id);
  const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Revive Me" });
  await db.event.update({ where: { id: event.id }, data: { eventVisibility: "PRIVATE" } });

  const token = "revive-token-001";
  await db.eventInvitation.create({ data: { eventId: event.id, linkedPersonId: admin.id, role: "PARTICIPANT", guestToken: token, invitedById: admin.id, scope: "INDIVIDUAL", status: "DECLINED" } });

  mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
  const res = await request(app).post(`/api/v1/events/${event.id}/participation/accept`).set("Authorization", "Bearer mock").send({ token });

  expect(res.status).toBe(200);
  expect(res.body.accepted).toBe(true);
  const grant = await db.eventParticipant.findUnique({ where: { eventId_personId: { eventId: event.id, personId: admin.id } } });
  expect(grant).toMatchObject({ status: "ACTIVE", role: "PARTICIPANT" });
  const inv = await db.eventInvitation.findFirst({ where: { eventId: event.id, guestToken: token } });
  expect(inv?.status).toBe("ACCEPTED");
});

it("accept: an ACCEPTED invitation whose grant was REVOKED cannot self-rejoin", async () => {
  const admin = await seedTestPerson();
  const { familyGroup } = await seedTestFamily(admin.id);
  const event = await seedTestEvent(familyGroup.id, admin.id, { title: "No Rejoin" });
  await db.event.update({ where: { id: event.id }, data: { eventVisibility: "PRIVATE" } });

  const token = "revoked-token-001";
  await db.eventInvitation.create({ data: { eventId: event.id, linkedPersonId: admin.id, role: "PARTICIPANT", guestToken: token, invitedById: admin.id, scope: "INDIVIDUAL", status: "ACCEPTED" } });
  await db.eventParticipant.create({ data: { eventId: event.id, personId: admin.id, role: "PARTICIPANT", status: "REVOKED" } });

  mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
  const res = await request(app).post(`/api/v1/events/${event.id}/participation/accept`).set("Authorization", "Bearer mock").send({ token });

  expect(res.status).toBe(403);
  const grant = await db.eventParticipant.findUnique({ where: { eventId_personId: { eventId: event.id, personId: admin.id } } });
  expect(grant?.status).toBe("REVOKED");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run (from `apps/api`): `npx vitest run src/__tests__/routes/events.test.ts -t "revives a previously DECLINED"`
Expected: FAIL — DECLINED does not match `status: "PENDING"`, handler 403s.

- [ ] **Step 3: Widen the accept filter**

In `POST /:eventId/participation/accept`, change the lookup:

```typescript
  const inv = await db.eventInvitation.findFirst({
    where: { eventId: p.data.eventId, guestToken: body.data.token, status: { in: ["PENDING", "DECLINED"] } }
  });
```

Leave the identity check and upsert unchanged. The decline handler is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `apps/api`): `npx vitest run src/__tests__/routes/events.test.ts -t "participation/accept"`
Expected: PASS — new + pre-existing accept/decline tests green (the REVOKED case 403s because its invitation is ACCEPTED, not in {PENDING, DECLINED}).

- [ ] **Step 5: Full verification + commit**

Run (from `apps/api`): `npx vitest run src/__tests__/routes/events.test.ts` then `npm run type-check` then `npm run lint`.

```bash
git add apps/api/src/routes/events.ts apps/api/src/__tests__/routes/events.test.ts
git commit -m "feat: P3-03 allow reviving a declined event participation"
```

---

## Task 3: `GET /api/v1/events/participation/preview?token=`

**Files:**
- Modify: `apps/api/src/routes/events.ts` (register **immediately before** `eventsRouter.get("/:eventId", …)` at ~line 238 so `/participation/preview` is not swallowed by `/:eventId`)
- Modify: `apps/api/src/__tests__/routes/events.test.ts`

**Interfaces:**
- Produces: `GET /api/v1/events/participation/preview?token=<token>`
  - **400** `{ error }` when the `token` query param is absent/empty (malformed request).
  - **403** `{ error }` when the token is not found or not addressed to the requester (reveals nothing).
  - **200** body:
    - PENDING / DECLINED → `{ state, eventId, eventTitle, startAt, endAt, locationName, role, invitedByName }`.
    - ACCEPTED + live grant → `{ state: "ACTIVE", eventId }` (redirect only — no detail).
    - ACCEPTED + revoked/absent grant, or any other status → `{ state: "UNAVAILABLE" }`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/__tests__/routes/events.test.ts`:

```typescript
describe("GET /api/v1/events/participation/preview (P3-03 W3a-UI)", () => {
  it("returns the allowlist preview for a PENDING invite to the requester, with no family name", async () => {
    const admin = await seedTestPerson({ firstName: "Alice", lastName: "Inviter" });
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Preview Event" });
    const token = "preview-pending-001";
    await db.eventInvitation.create({ data: { eventId: event.id, linkedPersonId: admin.id, role: "PARTICIPANT", guestToken: token, invitedById: admin.id, scope: "INDIVIDUAL", status: "PENDING" } });

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app).get(`/api/v1/events/participation/preview?token=${token}`).set("Authorization", "Bearer mock");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: "PENDING", eventId: event.id, eventTitle: "Preview Event", role: "PARTICIPANT", invitedByName: "Alice" });
    expect(JSON.stringify(res.body)).not.toContain("Test Family");
  });

  it("returns state DECLINED for a declined invite", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Declined Preview" });
    await db.eventInvitation.create({ data: { eventId: event.id, linkedPersonId: admin.id, role: "PARTICIPANT", guestToken: "preview-declined-001", invitedById: admin.id, scope: "INDIVIDUAL", status: "DECLINED" } });
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app).get(`/api/v1/events/participation/preview?token=preview-declined-001`).set("Authorization", "Bearer mock");
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("DECLINED");
  });

  it("returns ACTIVE (redirect-only) when accepted+active, UNAVAILABLE when revoked", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const active = await seedTestEvent(familyGroup.id, admin.id, { title: "Active" });
    await db.eventInvitation.create({ data: { eventId: active.id, linkedPersonId: admin.id, role: "PARTICIPANT", guestToken: "preview-active-001", invitedById: admin.id, scope: "INDIVIDUAL", status: "ACCEPTED" } });
    await db.eventParticipant.create({ data: { eventId: active.id, personId: admin.id, role: "PARTICIPANT", status: "ACTIVE" } });
    const revoked = await seedTestEvent(familyGroup.id, admin.id, { title: "Revoked" });
    await db.eventInvitation.create({ data: { eventId: revoked.id, linkedPersonId: admin.id, role: "PARTICIPANT", guestToken: "preview-revoked-001", invitedById: admin.id, scope: "INDIVIDUAL", status: "ACCEPTED" } });
    await db.eventParticipant.create({ data: { eventId: revoked.id, personId: admin.id, role: "PARTICIPANT", status: "REVOKED" } });

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const a = await request(app).get(`/api/v1/events/participation/preview?token=preview-active-001`).set("Authorization", "Bearer mock");
    expect(a.body).toEqual({ state: "ACTIVE", eventId: active.id });
    const r = await request(app).get(`/api/v1/events/participation/preview?token=preview-revoked-001`).set("Authorization", "Bearer mock");
    expect(r.body).toEqual({ state: "UNAVAILABLE" });
  });

  it("returns 403 for a token addressed to someone else, 400 for a missing token", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Not Yours" });
    const outsider = await seedSecondPerson();
    await db.eventInvitation.create({ data: { eventId: event.id, linkedPersonId: outsider.id, role: "PARTICIPANT", guestToken: "preview-notyours-001", invitedById: admin.id, scope: "INDIVIDUAL", status: "PENDING" } });
    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const notYours = await request(app).get(`/api/v1/events/participation/preview?token=preview-notyours-001`).set("Authorization", "Bearer mock");
    expect(notYours.status).toBe(403);
    const missing = await request(app).get(`/api/v1/events/participation/preview`).set("Authorization", "Bearer mock");
    expect(missing.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run (from `apps/api`): `npx vitest run src/__tests__/routes/events.test.ts -t "participation/preview"`
Expected: FAIL — route not defined.

- [ ] **Step 3: Implement the preview route**

In `apps/api/src/routes/events.ts`, **immediately before** `eventsRouter.get("/:eventId", …)` (~line 238), add:

```typescript
const PreviewQuerySchema = z.object({ token: z.string().min(1) });

eventsRouter.get("/participation/preview", async (req, res) => {
  const q = PreviewQuerySchema.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: "Missing token" }); return; }
  const requester = personed(req).person;

  const inv = await db.eventInvitation.findFirst({ where: { guestToken: q.data.token } });
  if (!inv || inv.linkedPersonId !== requester.id) {
    res.status(403).json({ error: "This invitation is not for your account" });
    return;
  }

  if (inv.status === "ACCEPTED") {
    const grant = await activeEventParticipant(requester.id, inv.eventId);
    if (!grant) { res.json({ state: "UNAVAILABLE" }); return; }
    res.json({ state: "ACTIVE", eventId: inv.eventId });
    return;
  }

  if (inv.status !== "PENDING" && inv.status !== "DECLINED") {
    res.json({ state: "UNAVAILABLE" });
    return;
  }
  const ev = await db.event.findUnique({ where: { id: inv.eventId } });
  if (!ev) { res.json({ state: "UNAVAILABLE" }); return; }

  let invitedByName = "Someone";
  if (inv.invitedById) {
    const inviter = await db.person.findUnique({ where: { id: inv.invitedById }, select: { firstName: true, preferredName: true } });
    if (inviter) invitedByName = inviter.preferredName ?? inviter.firstName;
  }

  res.json({
    state: inv.status,
    eventId: ev.id,
    eventTitle: ev.title,
    startAt: ev.startAt.toISOString(),
    endAt: ev.endAt?.toISOString() ?? null,
    locationName: ev.locationName,
    role: inv.role ?? "PARTICIPANT",
    invitedByName
  });
});
```

(`activeEventParticipant`, `personed`, `z`, `db` are already imported.)

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `apps/api`): `npx vitest run src/__tests__/routes/events.test.ts -t "participation/preview"`
Expected: PASS (all four).

- [ ] **Step 5: Full verification + commit**

Run (from `apps/api`): `npx vitest run src/__tests__/routes/events.test.ts` then `npm run type-check` then `npm run lint`.

```bash
git add apps/api/src/routes/events.ts apps/api/src/__tests__/routes/events.test.ts
git commit -m "feat: P3-03 add identity-bound participation preview endpoint"
```

---

## Task 4: `GET /api/v1/events/:eventId/participants` (owning members only)

Management list. **Gated to owning members only** — a cross-family participant, even one granted `EVENT_ADMIN`, gets 403 (they use the foreign DTO's attendee list; the roster + person ids must not cross the family boundary).

**Files:**
- Modify: `apps/api/src/routes/events.ts` (near the revoke/role handlers, ~line 952)
- Modify: `apps/api/src/__tests__/routes/events.test.ts`

**Interfaces:**
- Produces: `GET /api/v1/events/:eventId/participants` → `{ participants: { personId: string; displayName: string; role: "PARTICIPANT" | "EVENT_ADMIN"; status: "ACTIVE" | "REVOKED" }[] }`.

- [ ] **Step 1: Write the failing tests**

```typescript
describe("GET /api/v1/events/:eventId/participants (P3-03 W3a-UI)", () => {
  it("returns grants (incl. revoked) for an owning admin", async () => {
    const admin = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(admin.id);
    const event = await seedTestEvent(familyGroup.id, admin.id, { title: "Manage" });
    const p1 = await seedGuestPerson({ firstName: "Active", lastName: "One" });
    const p2 = await seedGuestPerson({ firstName: "Revoked", lastName: "Two" });
    await db.eventParticipant.create({ data: { eventId: event.id, personId: p1.id, role: "PARTICIPANT", status: "ACTIVE" } });
    await db.eventParticipant.create({ data: { eventId: event.id, personId: p2.id, role: "EVENT_ADMIN", status: "REVOKED" } });

    mockGetAuth.mockReturnValue({ userId: TEST_CLERK_ID });
    const res = await request(app).get(`/api/v1/events/${event.id}/participants`).set("Authorization", "Bearer mock");

    expect(res.status).toBe(200);
    expect(res.body.participants).toEqual(expect.arrayContaining([
      expect.objectContaining({ personId: p1.id, displayName: "Active", role: "PARTICIPANT", status: "ACTIVE" }),
      expect.objectContaining({ personId: p2.id, displayName: "Revoked", role: "EVENT_ADMIN", status: "REVOKED" })
    ]));
  });

  it("returns 403 for a cross-family EVENT_ADMIN participant (non-member must not read the roster)", async () => {
    const owner = await seedTestPerson();
    const { familyGroup } = await seedTestFamily(owner.id);
    const event = await seedTestEvent(familyGroup.id, owner.id, { title: "Foreign Admin" });
    const outsider = await seedSecondPerson(); // not a member of familyGroup
    await db.eventParticipant.create({ data: { eventId: event.id, personId: outsider.id, role: "EVENT_ADMIN", status: "ACTIVE" } });

    mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID });
    const res = await request(app).get(`/api/v1/events/${event.id}/participants`).set("Authorization", "Bearer mock");
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run (from `apps/api`): `npx vitest run src/__tests__/routes/events.test.ts -t "events/:eventId/participants"`
Expected: FAIL — route not defined.

- [ ] **Step 3: Implement the participants list route (members-only gate)**

In `apps/api/src/routes/events.ts`, near the revoke/role handlers (~line 952):

```typescript
eventsRouter.get("/:eventId/participants", async (req, res) => {
  const requester = personed(req).person;
  const access = await resolveEventAccess(req.params.eventId, requester.id);
  if ("error" in access) { res.status(404).json({ error: "Event not found" }); return; }
  // Owning members ONLY. A cross-family participant (even EVENT_ADMIN) must not read
  // the roster / person ids across the family boundary — they use the foreign DTO.
  if (!access.isOwningMember) { res.status(403).json({ error: "Not authorized to view participants" }); return; }

  const grants = await db.eventParticipant.findMany({ where: { eventId: req.params.eventId }, orderBy: { createdAt: "asc" } });
  const persons = await db.person.findMany({ where: { id: { in: grants.map((g) => g.personId) } }, select: { id: true, firstName: true, preferredName: true } });
  const nameById = new Map(persons.map((p) => [p.id, p.preferredName ?? p.firstName]));

  res.json({
    participants: grants.map((g) => ({ personId: g.personId, displayName: nameById.get(g.personId) ?? "Participant", role: g.role, status: g.status }))
  });
});
```

(`resolveEventAccess` is already imported.)

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `apps/api`): `npx vitest run src/__tests__/routes/events.test.ts -t "events/:eventId/participants"`
Expected: PASS (both).

- [ ] **Step 5: Full verification + commit**

Run (from `apps/api`): `npx vitest run src/__tests__/routes/events.test.ts` then `npm run type-check` then `npm run lint`.

```bash
git add apps/api/src/routes/events.ts apps/api/src/__tests__/routes/events.test.ts
git commit -m "feat: P3-03 add owning-member-only participants list endpoint"
```

---

## Task 5: Expose `isOwn` on foreign event items (enabler for edit/delete-own)

`foreignItemShape` strips `createdByPersonId` (isolation), so the foreign viewer cannot tell which tasks are the participant's own. Add an isolation-safe `isOwn` boolean (no person id leaks) so the client can scope edit-own/delete-own controls. The API already ownership-enforces the mutations (`authorizeItemMutation`); `isOwn` is purely a UI affordance.

**Files:**
- Modify: `apps/api/src/routes/events.ts` (`foreignItemShape` ~line 149 + its 3 call sites: ~349, ~994, ~1015)
- Modify: `apps/api/src/__tests__/routes/events.test.ts`

**Interfaces:**
- Produces: `foreignItemShape(p: EventItem, requesterId: string)` → `{ id, name, quantity, notes, status, isOwn: boolean }`. The foreign DTO's `tasks[]` and the foreign item create/patch responses now carry `isOwn`.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/__tests__/routes/events.test.ts` (a cross-family participant fetching the event sees `isOwn` per task):

```typescript
it("foreign DTO tasks carry isOwn for the requesting participant (no person ids)", async () => {
  const owner = await seedTestPerson();
  const { familyGroup } = await seedTestFamily(owner.id);
  const event = await seedTestEvent(familyGroup.id, owner.id, { title: "Shared" });
  await db.event.update({ where: { id: event.id }, data: { eventVisibility: "PRIVATE" } });

  const participant = await seedSecondPerson();
  await db.eventParticipant.create({ data: { eventId: event.id, personId: participant.id, role: "PARTICIPANT", status: "ACTIVE" } });
  await db.eventItem.create({ data: { eventId: event.id, createdByPersonId: owner.id, name: "Owner Item" } });
  await db.eventItem.create({ data: { eventId: event.id, createdByPersonId: participant.id, name: "My Item" } });

  mockGetAuth.mockReturnValue({ userId: TEST_USER_2_CLERK_ID }); // the participant
  const res = await request(app).get(`/api/v1/events/${event.id}`).set("Authorization", "Bearer mock");

  expect(res.status).toBe(200);
  const mine = res.body.tasks.find((t: { name: string }) => t.name === "My Item");
  const theirs = res.body.tasks.find((t: { name: string }) => t.name === "Owner Item");
  expect(mine.isOwn).toBe(true);
  expect(theirs.isOwn).toBe(false);
  expect(mine).not.toHaveProperty("createdByPersonId"); // still no person ids
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `apps/api`): `npx vitest run src/__tests__/routes/events.test.ts -t "carry isOwn"`
Expected: FAIL — tasks have no `isOwn`.

- [ ] **Step 3: Add the `isOwn` parameter + update call sites**

In `apps/api/src/routes/events.ts`, change `foreignItemShape` (~line 149):

```typescript
function foreignItemShape(p: EventItem, requesterId: string) {
  return { id: p.id, name: p.name, quantity: p.quantity, notes: p.notes, status: p.status, isOwn: p.createdByPersonId === requesterId };
}
```

Update the three call sites:
- Foreign DTO build (~line 349): `const foreignTasks = items.map((p) => foreignItemShape(p, requester.id));`
- Item create response (~line 994): `res.status(201).json(isForeign ? foreignItemShape(created, requester.id) : serializeEventItem(created));`
- Item patch response (~line 1015): `res.json(isForeign ? foreignItemShape(updated, requester.id) : serializeEventItem(updated));`

- [ ] **Step 4: Run the test to verify it passes**

Run (from `apps/api`): `npx vitest run src/__tests__/routes/events.test.ts -t "carry isOwn"`
Expected: PASS.

- [ ] **Step 5: Full verification + commit**

Run (from `apps/api`): `npx vitest run src/__tests__/routes/events.test.ts` then `npm run type-check` then `npm run lint`.

```bash
git add apps/api/src/routes/events.ts apps/api/src/__tests__/routes/events.test.ts
git commit -m "feat: P3-03 expose isOwn on foreign event items for own-task controls"
```

---

## Task 6: Web API client — participation, participants, items, tagged invites

**Files:**
- Modify: `apps/web/lib/api/family.ts` (add `roles: string[]` to `FamilyMembership`)
- Modify: `apps/web/lib/api/events.ts`
- Create: `apps/web/lib/api/__tests__/events.client.test.ts`

**Interfaces:**
- Produces (exported from `apps/web/lib/api/events.ts`):
  - `InviteeEntry = { kind: "person"; personId } | { kind: "famlinkUser"; personId; role?: "PARTICIPANT" | "EVENT_ADMIN" } | { kind: "guest"; guestEmail?; guestPhone?; guestName? }`
  - `ParticipationState = "PENDING" | "DECLINED" | "ACTIVE" | "UNAVAILABLE"`
  - `ParticipationPreview = { state: ParticipationState; eventId?; eventTitle?; startAt?; endAt?: string|null; locationName?: string|null; role?: "PARTICIPANT"|"EVENT_ADMIN"; invitedByName? }`
  - `ParticipantRecord = { personId; displayName; role: "PARTICIPANT"|"EVENT_ADMIN"; status: "ACTIVE"|"REVOKED" }`
  - `ForeignEventItem = { id; name; quantity: string|null; notes: string|null; status: string; isOwn: boolean }`
  - `ForeignEventDTO = { id; title; description: string|null; startAt; endAt: string|null; locationName: string|null; locationAddress: string|null; locationMapUrl: string|null; eventType: EventType; participants: { displayName: string; rsvpStatus: RsvpStatus|null }[]; tasks: ForeignEventItem[] }`
  - `isForeignEventDTO(d): d is ForeignEventDTO` (`!("event" in d)`)
  - `previewParticipation(token, getToken)`, `acceptParticipation(eventId, token, getToken)`, `declineParticipation(eventId, token, getToken)`, `listParticipants(eventId, getToken)`, `revokeParticipant(eventId, personId, getToken)`, `setParticipantRole(eventId, personId, role, getToken)`, `addItem(eventId, data, getToken)`, `patchItem(eventId, itemId, data, getToken)`, `deleteItem(eventId, itemId, getToken)`

- [ ] **Step 1: Write the failing client test**

Create `apps/web/lib/api/__tests__/events.client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as api from "@/lib/api";
import { previewParticipation, acceptParticipation, isForeignEventDTO } from "@/lib/api/events";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
const apiFetch = vi.mocked(api.apiFetch);
const getToken = vi.fn().mockResolvedValue("t");

beforeEach(() => apiFetch.mockReset());

describe("events client — participation", () => {
  it("previewParticipation calls the relative preview path with auth (getToken)", async () => {
    apiFetch.mockResolvedValue({ state: "PENDING", eventId: "e1" });
    await previewParticipation("tok123", getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/participation/preview?token=tok123",
      expect.objectContaining({ method: "GET", getToken })
    );
  });

  it("acceptParticipation posts the token to the event's accept route", async () => {
    apiFetch.mockResolvedValue({ accepted: true });
    await acceptParticipation("e1", "tok123", getToken);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/participation/accept",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ token: "tok123" }), getToken })
    );
  });

  it("isForeignEventDTO distinguishes the flat foreign shape from the member shape", () => {
    expect(isForeignEventDTO({ id: "e", title: "t", participants: [], tasks: [] } as never)).toBe(true);
    expect(isForeignEventDTO({ event: { id: "e" } } as never)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `apps/web`): `npx vitest run lib/api/__tests__/events.client.test.ts`
Expected: FAIL — exports not defined.

- [ ] **Step 3a: Add `roles` to the web membership type**

In `apps/web/lib/api/family.ts`, extend `FamilyMembership` (the API already sends `roles`):

```typescript
export interface FamilyMembership {
  familyGroup: FamilyGroupSummary;
  role: string;
  roles: string[];
  joinedAt: string;
}
```

- [ ] **Step 3b: Implement the client additions**

In `apps/web/lib/api/events.ts`, replace the existing `InviteeEntry` interface (~lines 173–178) with:

```typescript
export type InviteeEntry =
  | { kind: "person"; personId: string }
  | { kind: "famlinkUser"; personId: string; role?: "PARTICIPANT" | "EVENT_ADMIN" }
  | { kind: "guest"; guestEmail?: string; guestPhone?: string; guestName?: string };
```

Change `getEventDetails` to the union:

```typescript
export function getEventDetails(eventId: string, getToken: GetToken): Promise<EventDetail | ForeignEventDTO> {
  return apiFetch<EventDetail | ForeignEventDTO>(`/api/v1/events/${encodeURIComponent(eventId)}`, { getToken, method: "GET" });
}
```

Append at the end of the file:

```typescript
// ── Cross-family participation (W3a-UI) ────────────────────────────────────────

export type ParticipationState = "PENDING" | "DECLINED" | "ACTIVE" | "UNAVAILABLE";

export interface ParticipationPreview {
  state: ParticipationState;
  eventId?: string;
  eventTitle?: string;
  startAt?: string;
  endAt?: string | null;
  locationName?: string | null;
  role?: "PARTICIPANT" | "EVENT_ADMIN";
  invitedByName?: string;
}

export interface ParticipantRecord {
  personId: string;
  displayName: string;
  role: "PARTICIPANT" | "EVENT_ADMIN";
  status: "ACTIVE" | "REVOKED";
}

export interface ForeignEventItem {
  id: string;
  name: string;
  quantity: string | null;
  notes: string | null;
  status: string;
  isOwn: boolean;
}

export interface ForeignEventDTO {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  locationName: string | null;
  locationAddress: string | null;
  locationMapUrl: string | null;
  eventType: EventType;
  participants: { displayName: string; rsvpStatus: RsvpStatus | null }[];
  tasks: ForeignEventItem[];
}

export function isForeignEventDTO(d: EventDetail | ForeignEventDTO): d is ForeignEventDTO {
  return !("event" in d);
}

export function previewParticipation(token: string, getToken: GetToken): Promise<ParticipationPreview> {
  return apiFetch<ParticipationPreview>(`/api/v1/events/participation/preview?token=${encodeURIComponent(token)}`, { method: "GET", getToken });
}

export function acceptParticipation(eventId: string, token: string, getToken: GetToken): Promise<{ accepted: boolean }> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/participation/accept`, { method: "POST", body: JSON.stringify({ token }), getToken });
}

export function declineParticipation(eventId: string, token: string, getToken: GetToken): Promise<{ declined: boolean }> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/participation/decline`, { method: "POST", body: JSON.stringify({ token }), getToken });
}

export function listParticipants(eventId: string, getToken: GetToken): Promise<{ participants: ParticipantRecord[] }> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/participants`, { method: "GET", getToken });
}

export function revokeParticipant(eventId: string, personId: string, getToken: GetToken): Promise<{ revoked: boolean }> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(personId)}/revoke`, { method: "POST", getToken });
}

export function setParticipantRole(eventId: string, personId: string, role: "PARTICIPANT" | "EVENT_ADMIN", getToken: GetToken): Promise<{ updated: boolean }> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(personId)}/role`, { method: "PUT", body: JSON.stringify({ role }), getToken });
}

export function addItem(eventId: string, data: { name: string; quantity?: string; notes?: string }, getToken: GetToken): Promise<ForeignEventItem | EventItem> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/items`, { method: "POST", body: JSON.stringify(data), getToken });
}

export function patchItem(eventId: string, itemId: string, data: Partial<{ name: string; quantity: string | null; notes: string | null; status: string }>, getToken: GetToken): Promise<ForeignEventItem | EventItem> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/items/${encodeURIComponent(itemId)}`, { method: "PATCH", body: JSON.stringify(data), getToken });
}

export function deleteItem(eventId: string, itemId: string, getToken: GetToken): Promise<void> {
  return apiFetch(`/api/v1/events/${encodeURIComponent(eventId)}/items/${encodeURIComponent(itemId)}`, { method: "DELETE", getToken });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `apps/web`): `npx vitest run lib/api/__tests__/events.client.test.ts`
Expected: PASS.

- [ ] **Step 5: Full verification + commit**

Run (from `apps/web`): `npx vitest run lib/api/__tests__/events.client.test.ts` then `npm run type-check` then `npm run lint`.

```bash
git add apps/web/lib/api/family.ts apps/web/lib/api/events.ts apps/web/lib/api/__tests__/events.client.test.ts
git commit -m "feat: P3-03 add web client for participation, participants, items"
```

---

## Task 7: Invite page — cross-family participant invites with role

Send suggestions as `kind:"famlinkUser"` with a per-suggestion admin toggle (admin-gated, keyed to the event's family); members as `kind:"person"`; external as `kind:"guest"`.

**Files:**
- Modify: `apps/web/app/(protected)/events/[eventId]/invite/page.tsx`
- Create: `apps/web/app/(protected)/events/[eventId]/invite/__tests__/invite.page.test.tsx`

**Interfaces:**
- Consumes: `sendInvitations`, `InviteeEntry`, `getEventDetails`, `isForeignEventDTO` (Task 6); `getEventInviteeSuggestions`, `getMyFamilies`, `getFamilyDetails`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/(protected)/events/[eventId]/invite/__tests__/invite.page.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import InvitePage from "../page";

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: vi.fn().mockResolvedValue("t") }) }));
vi.mock("next/navigation", () => ({ useParams: () => ({ eventId: "e1" }), useRouter: () => ({ push: vi.fn() }) }));

const mockSend = vi.fn().mockResolvedValue({ invitations: [] });
vi.mock("@/lib/api/events", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/events")>("@/lib/api/events");
  return {
    ...actual,
    sendInvitations: (...a: unknown[]) => mockSend(...a),
    getEventInviteeSuggestions: vi.fn(),
    getEventDetails: vi.fn()
  };
});
vi.mock("@/lib/api/family", () => ({ getMyFamilies: vi.fn(), getFamilyDetails: vi.fn() }));

const queryData: Record<string, unknown> = {};
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({ data: queryData[String(queryKey[0])] })
}));

beforeEach(() => {
  mockSend.mockClear();
  queryData["event"] = { event: { id: "e1", familyGroupId: "fam1" } };       // member shape
  queryData["families"] = [{ familyGroup: { id: "fam1" }, role: "ADMIN", roles: ["ADMIN", "ORGANIZER"] }];
  queryData["family-detail"] = { members: [] };
  queryData["invitee-suggestions"] = { suggestions: [{ person: { id: "p2", displayName: "Cross Person", avatarUrl: null }, via: { personId: "p1", personName: "Me", relationshipType: "CO_PARENT", relationshipState: "ACTIVE" }, sharedChildren: [] }] };
});

describe("InvitePage cross-family invites", () => {
  it("sends a suggestion as kind:famlinkUser role EVENT_ADMIN when the admin toggle is on", async () => {
    render(<InvitePage />);
    await userEvent.click(screen.getByLabelText("Cross Person"));
    await userEvent.click(screen.getByLabelText(/make event admin/i));
    await userEvent.click(screen.getByRole("button", { name: /send invitations/i }));
    expect(mockSend).toHaveBeenCalledWith("e1", [{ kind: "famlinkUser", personId: "p2", role: "EVENT_ADMIN" }], expect.anything());
  });

  it("hides the admin toggle for a non-admin viewer of the event's family", () => {
    queryData["families"] = [{ familyGroup: { id: "fam1" }, role: "MEMBER", roles: ["MEMBER"] }];
    render(<InvitePage />);
    expect(screen.queryByLabelText(/make event admin/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `apps/web`): `npx vitest run "app/(protected)/events/[eventId]/invite/__tests__/invite.page.test.tsx"`
Expected: FAIL — page sends bare `{ personId }`, has no admin toggle, and has no event/family-scoped admin check.

- [ ] **Step 3: Implement the invite-page changes**

In `apps/web/app/(protected)/events/[eventId]/invite/page.tsx`:

1. Add imports + an event query, and derive the event's family + admin from it:

```typescript
import { getEventInviteeSuggestions, sendInvitations, getEventDetails } from "@/lib/api/events";
import type { InviteeEntry, InviteeSuggestion } from "@/lib/api/events";
import { isForeignEventDTO } from "@/lib/api/events";
```

```typescript
  const eventQuery = useQuery({ queryKey: ["event", eventId], queryFn: () => getEventDetails(eventId, getToken), enabled: !!eventId });
  const eventData = eventQuery.data;
  const eventFamilyId = eventData && !isForeignEventDTO(eventData) ? eventData.event.familyGroupId : null;
```

2. Replace the `familyId` derivation (currently `families?.[0]?.familyGroup.id`) so members/suggestions/admin all key off the event's family:

```typescript
  const families = familiesQuery.data ?? [];
  const familyId = eventFamilyId ?? families[0]?.familyGroup.id ?? null;
  const myMembership = families.find((f) => f.familyGroup.id === familyId);
  const canAdmin = (myMembership?.roles ?? []).some((r) => r === "ADMIN" || r === "ORGANIZER");
```

(Keep `getFamilyDetails(familyId)` for the members list — now correctly the event's family.)

3. Add suggestion-selection + per-suggestion admin state:

```typescript
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<string>>(new Set());
  const [adminSuggestionIds, setAdminSuggestionIds] = useState<Set<string>>(new Set());
```

4. Build the tagged invitee list in `handleSend`:

```typescript
  async function handleSend() {
    setSending(true);
    const invitees: InviteeEntry[] = [
      ...[...selectedPersonIds].map((id): InviteeEntry => ({ kind: "person", personId: id })),
      ...[...selectedSuggestionIds].map((id): InviteeEntry => ({ kind: "famlinkUser", personId: id, role: adminSuggestionIds.has(id) ? "EVENT_ADMIN" : "PARTICIPANT" })),
      ...(externalEmail || externalPhone
        ? [{ kind: "guest", guestEmail: externalEmail || undefined, guestPhone: externalPhone || undefined, guestName: externalName || "Guest" } as InviteeEntry]
        : [])
    ];
    if (invitees.length > 0) { await sendInvitations(eventId, invitees, getToken); }
    router.push(`/events/${eventId}`);
  }
```

5. In the suggestions list, bind the checkbox to `selectedSuggestionIds` and render the admin toggle only when `canAdmin`:

```tsx
                <input
                  type="checkbox"
                  aria-label={s.person.displayName}
                  checked={selectedSuggestionIds.has(s.person.id)}
                  onChange={() => setSelectedSuggestionIds(prev => { const next = new Set(prev); next.has(s.person.id) ? next.delete(s.person.id) : next.add(s.person.id); return next; })}
                  style={{ accentColor: "var(--color-primary, #6366f1)", width: "16px", height: "16px" }}
                />
                {/* …existing name/subtext block… */}
                {canAdmin && selectedSuggestionIds.has(s.person.id) && (
                  <label style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "auto", fontSize: "11px", color: "var(--text-muted)" }}>
                    <input
                      type="checkbox"
                      aria-label={`make event admin: ${s.person.displayName}`}
                      checked={adminSuggestionIds.has(s.person.id)}
                      onChange={() => setAdminSuggestionIds(prev => { const next = new Set(prev); next.has(s.person.id) ? next.delete(s.person.id) : next.add(s.person.id); return next; })}
                    />
                    make event admin
                  </label>
                )}
```

(The member list keeps `selectedPersonIds`/`togglePerson` unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run (from `apps/web`): `npx vitest run "app/(protected)/events/[eventId]/invite/__tests__/invite.page.test.tsx"`
Expected: PASS (both).

- [ ] **Step 5: Full verification + commit**

Run (from `apps/web`): the test above, then `npm run type-check`, then `npm run lint`.

```bash
git add "apps/web/app/(protected)/events/[eventId]/invite/page.tsx" "apps/web/app/(protected)/events/[eventId]/invite/__tests__/invite.page.test.tsx"
git commit -m "feat: P3-03 invite cross-family participants with role from invite page"
```

---

## Task 8: Accept page — accept / decline / revive (state matrix)

**Files:**
- Create: `apps/web/app/events/accept/page.tsx`
- Create: `apps/web/app/events/accept/AcceptClient.tsx`
- Create: `apps/web/app/events/accept/__tests__/AcceptClient.test.tsx`

**Interfaces:**
- Consumes: `previewParticipation(token, getToken)`, `acceptParticipation`, `declineParticipation` (Task 6).
- Produces: `AcceptClient({ token }: { token: string })`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/events/accept/__tests__/AcceptClient.test.tsx`:

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AcceptClient } from "../AcceptClient";

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: vi.fn().mockResolvedValue("t") }) }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const mockPreview = vi.fn();
const mockAccept = vi.fn().mockResolvedValue({ accepted: true });
const mockDecline = vi.fn().mockResolvedValue({ declined: true });
vi.mock("@/lib/api/events", () => ({
  previewParticipation: (...a: unknown[]) => mockPreview(...a),
  acceptParticipation: (...a: unknown[]) => mockAccept(...a),
  declineParticipation: (...a: unknown[]) => mockDecline(...a)
}));

beforeEach(() => { push.mockClear(); mockPreview.mockReset(); mockAccept.mockClear(); mockDecline.mockClear(); });

describe("AcceptClient", () => {
  it("PENDING: renders summary and accepts", async () => {
    mockPreview.mockResolvedValue({ state: "PENDING", eventId: "e1", eventTitle: "Picnic", role: "PARTICIPANT", invitedByName: "Alice" });
    render(<AcceptClient token="tok1" />);
    expect(await screen.findByText("Picnic")).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^accept$/i }));
    await waitFor(() => expect(mockAccept).toHaveBeenCalledWith("e1", "tok1", expect.anything()));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/e1"));
  });

  it("DECLINED: shows a re-accept nudge with an Accept button", async () => {
    mockPreview.mockResolvedValue({ state: "DECLINED", eventId: "e1", eventTitle: "Picnic", role: "PARTICIPANT", invitedByName: "Alice" });
    render(<AcceptClient token="tok1" />);
    expect(await screen.findByText(/declined/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument();
  });

  it("ACTIVE: redirects to the event", async () => {
    mockPreview.mockResolvedValue({ state: "ACTIVE", eventId: "e9" });
    render(<AcceptClient token="tok1" />);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/e9"));
  });

  it("UNAVAILABLE: generic message, no event detail", async () => {
    mockPreview.mockResolvedValue({ state: "UNAVAILABLE" });
    render(<AcceptClient token="tok1" />);
    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
  });

  it("decline shows an inline confirmation", async () => {
    mockPreview.mockResolvedValue({ state: "PENDING", eventId: "e1", eventTitle: "Picnic", role: "PARTICIPANT", invitedByName: "Alice" });
    render(<AcceptClient token="tok1" />);
    await screen.findByText("Picnic");
    await userEvent.click(screen.getByRole("button", { name: /decline/i }));
    expect(await screen.findByText(/you declined/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `apps/web`): `npx vitest run app/events/accept/__tests__/AcceptClient.test.tsx`
Expected: FAIL — `AcceptClient` does not exist.

- [ ] **Step 3: Implement `AcceptClient`**

Create `apps/web/app/events/accept/AcceptClient.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { previewParticipation, acceptParticipation, declineParticipation, type ParticipationPreview } from "@/lib/api/events";

type View = "loading" | "pending" | "declined" | "unavailable" | "declined-confirmed";

export function AcceptClient({ token }: { token: string }) {
  const router = useRouter();
  const { getToken } = useAuth();
  const [preview, setPreview] = useState<ParticipationPreview | null>(null);
  const [view, setView] = useState<View>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    previewParticipation(token, getToken)
      .then((p) => {
        if (!active) return;
        if (p.state === "ACTIVE" && p.eventId) { router.push(`/events/${p.eventId}`); return; }
        if (p.state === "PENDING") { setPreview(p); setView("pending"); return; }
        if (p.state === "DECLINED") { setPreview(p); setView("declined"); return; }
        setView("unavailable");
      })
      .catch(() => { if (active) setView("unavailable"); });
    return () => { active = false; };
  }, [token, getToken, router]);

  async function onAccept() {
    if (!preview?.eventId) return;
    setBusy(true);
    try { await acceptParticipation(preview.eventId, token, getToken); router.push(`/events/${preview.eventId}`); }
    finally { setBusy(false); }
  }

  async function onDecline() {
    if (!preview?.eventId) return;
    setBusy(true);
    try { await declineParticipation(preview.eventId, token, getToken); setView("declined-confirmed"); }
    finally { setBusy(false); }
  }

  if (view === "loading") return <main style={{ padding: 24 }}><p>Loading…</p></main>;

  if (view === "unavailable") {
    return <main style={{ maxWidth: 480, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>This invitation is no longer available</h1>
      <p style={{ marginTop: 8 }}><Link href="/">Go home</Link></p>
    </main>;
  }

  if (view === "declined-confirmed") {
    return <main style={{ maxWidth: 480, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>You declined this invitation</h1>
      <p style={{ marginTop: 8 }}><Link href="/">Go home</Link></p>
    </main>;
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>{preview?.eventTitle}</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)" }}>
        Invited by {preview?.invitedByName} as {preview?.role === "EVENT_ADMIN" ? "an event admin" : "a participant"}
      </p>
      {preview?.startAt && <p style={{ marginTop: 4 }}>{new Date(preview.startAt).toLocaleString()}</p>}
      {preview?.locationName && <p style={{ color: "var(--text-muted)" }}>{preview.locationName}</p>}
      {view === "declined" && <p style={{ marginTop: 12 }}>You declined this earlier — want back in?</p>}
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button onClick={onAccept} disabled={busy} style={{ padding: "10px 16px", fontWeight: 600 }}>Accept</button>
        {view === "pending" && <button onClick={onDecline} disabled={busy} style={{ padding: "10px 16px" }}>Decline</button>}
      </div>
    </main>
  );
}
```

Create `apps/web/app/events/accept/page.tsx` (server component reads the token; never log it):

```tsx
import { AcceptClient } from "./AcceptClient";

export default async function AcceptPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) {
    return <main style={{ maxWidth: 480, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>This invitation is no longer available</h1>
    </main>;
  }
  return <AcceptClient token={token} />;
}
```

- [ ] **Step 4: Ensure Clerk gates `/events/accept`**

`/events/accept` is outside the `(protected)` route group. Open `apps/web/middleware.ts` (or wherever the Clerk middleware/matcher lives) and confirm a signed-out visitor to `/events/accept` is sent to sign-in and returned here (the API identity-binds the token, so an authenticated user is required). If the matcher excludes it, add `/events/accept` to the protected matcher, following the existing convention in that file. Do not invent a new auth mechanism.

- [ ] **Step 5: Run the test to verify it passes**

Run (from `apps/web`): `npx vitest run app/events/accept/__tests__/AcceptClient.test.tsx`
Expected: PASS (all five).

- [ ] **Step 6: Full verification + commit**

Run (from `apps/web`): the test above, then `npm run type-check`, then `npm run lint`.

```bash
git add apps/web/app/events/accept/ apps/web/middleware.ts
git commit -m "feat: P3-03 add cross-family participation accept page"
```

---

## Task 9: Event detail — foreign participant viewer (read + RSVP + own-task contribution)

Render the isolation-safe foreign DTO for a cross-family participant: fields, attendees, an RSVP control, and task contribution (add any; delete/edit only `isOwn` tasks — the API enforces ownership, `isOwn` scopes the controls).

**Files:**
- Create: `apps/web/components/events/ForeignEventDetail.tsx`
- Create: `apps/web/components/events/__tests__/ForeignEventDetail.test.tsx`
- Modify: `apps/web/app/(protected)/events/[eventId]/page.tsx`

**Interfaces:**
- Consumes: `ForeignEventDTO`, `ForeignEventItem`, `isForeignEventDTO`, `addItem`, `deleteItem` (Task 6); `RsvpButton` (existing).
- Produces: `ForeignEventDetail({ dto, eventId }: { dto: ForeignEventDTO; eventId: string })`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/events/__tests__/ForeignEventDetail.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ForeignEventDetail } from "@/components/events/ForeignEventDetail";
import type { ForeignEventDTO } from "@/lib/api/events";

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock("@/components/events/RsvpButton", () => ({ RsvpButton: () => <div data-testid="rsvp" /> }));
vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() })
}));
vi.mock("@/lib/api/events", () => ({ addItem: vi.fn(), deleteItem: vi.fn() }));

const dto: ForeignEventDTO = {
  id: "e1", title: "Shared Picnic", description: "Bring food", startAt: "2026-07-04T17:00:00Z", endAt: null,
  locationName: "Park", locationAddress: null, locationMapUrl: null, eventType: "PARTY",
  participants: [{ displayName: "Alice", rsvpStatus: "YES" }, { displayName: "Bob", rsvpStatus: null }],
  tasks: [
    { id: "i1", name: "Mine", quantity: null, notes: null, status: "UNCLAIMED", isOwn: true },
    { id: "i2", name: "Theirs", quantity: null, notes: null, status: "UNCLAIMED", isOwn: false }
  ]
};

describe("ForeignEventDetail", () => {
  it("renders fields, attendees, RSVP, tasks, and a delete only on own tasks", () => {
    render(<ForeignEventDetail dto={dto} eventId="e1" />);
    expect(screen.getByText("Shared Picnic")).toBeInTheDocument();
    expect(screen.getByText("Park")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByTestId("rsvp")).toBeInTheDocument();
    expect(screen.getByText("Mine")).toBeInTheDocument();
    expect(screen.getByText("Theirs")).toBeInTheDocument();
    // delete control only on the own task
    expect(screen.getAllByRole("button", { name: /delete/i }).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `apps/web`): `npx vitest run components/events/__tests__/ForeignEventDetail.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement `ForeignEventDetail`**

Create `apps/web/components/events/ForeignEventDetail.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addItem, deleteItem, type ForeignEventDTO } from "@/lib/api/events";
import { RsvpButton } from "@/components/events/RsvpButton";

export function ForeignEventDetail({ dto, eventId }: { dto: ForeignEventDTO; eventId: string }) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const [newItem, setNewItem] = useState("");

  const add = useMutation({
    mutationFn: (name: string) => addItem(eventId, { name }, getToken),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["event", eventId] })
  });
  const remove = useMutation({
    mutationFn: (itemId: string) => deleteItem(eventId, itemId, getToken),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["event", eventId] })
  });

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>{dto.title}</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>{new Date(dto.startAt).toLocaleString()}</p>
        {dto.locationName && <p className="text-sm" style={{ color: "var(--text-muted)" }}>{dto.locationName}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Your RSVP</p>
        <RsvpButton eventId={eventId} currentStatus={null} />
      </div>

      {dto.description && <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{dto.description}</p>}

      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Attendees</p>
        {dto.participants.length === 0
          ? <p className="text-xs italic" style={{ color: "var(--text-muted)" }}>None yet</p>
          : dto.participants.map((p, i) => (
              <div key={i} className="flex items-center justify-between rounded-md px-3 py-2" style={{ border: "1px solid var(--border)", background: "var(--bg-card)" }}>
                <span className="text-sm" style={{ color: "var(--text-primary)" }}>{p.displayName}</span>
                {p.rsvpStatus && <span className="text-xs" style={{ color: "var(--text-muted)" }}>{p.rsvpStatus}</span>}
              </div>
            ))}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Items</p>
        {dto.tasks.map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded-md px-3 py-2" style={{ border: "1px solid var(--border)", background: "var(--bg-card)" }}>
            <span className="text-sm" style={{ color: "var(--text-primary)" }}>{t.name}{t.quantity ? ` · ${t.quantity}` : ""}</span>
            {t.isOwn && <button onClick={() => remove.mutate(t.id)} className="text-xs" style={{ color: "var(--danger, #dc2626)" }}>Delete</button>}
          </div>
        ))}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            aria-label="add item"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            placeholder="Add an item"
            style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)" }}
          />
          <button onClick={() => { if (newItem.trim()) { add.mutate(newItem.trim()); setNewItem(""); } }} style={{ padding: "8px 12px" }}>Add</button>
        </div>
      </div>
    </div>
  );
}
```

> Edit-own is intentionally out of this task's first green build (delete-own + add cover contribution). If desired, an inline name edit using `patchItem` on `isOwn` tasks can be layered in a follow-up within this file without interface changes.

- [ ] **Step 4: Branch the event-detail page on DTO shape**

In `apps/web/app/(protected)/events/[eventId]/page.tsx`, update imports and add the branch right after the `isError || !data` guard (~line 62):

```tsx
import { getEventDetails, isForeignEventDTO } from "@/lib/api/events";
import { ForeignEventDetail } from "@/components/events/ForeignEventDetail";
```

```tsx
  if (isForeignEventDTO(data)) {
    return <ForeignEventDetail dto={data} eventId={eventId} />;
  }

  const { event, rsvps, eventItems } = data; // member path below, unchanged
```

- [ ] **Step 5: Run the component test + typecheck the page**

Run (from `apps/web`): `npx vitest run components/events/__tests__/ForeignEventDetail.test.tsx` then `npm run type-check`.
Expected: PASS / no type errors (the guard narrows `data` to `EventDetail` for the member path).

- [ ] **Step 6: Lint + commit**

Run (from `apps/web`): `npm run lint`.

```bash
git add apps/web/components/events/ForeignEventDetail.tsx apps/web/components/events/__tests__/ForeignEventDetail.test.tsx "apps/web/app/(protected)/events/[eventId]/page.tsx"
git commit -m "feat: P3-03 render foreign DTO with task contribution for participants"
```

---

## Task 10: Event detail — owning-member participant management

**Files:**
- Create: `apps/web/components/events/ParticipantsSection.tsx`
- Create: `apps/web/components/events/__tests__/ParticipantsSection.test.tsx`
- Modify: `apps/web/app/(protected)/events/[eventId]/page.tsx`

**Interfaces:**
- Consumes: `listParticipants`, `revokeParticipant`, `setParticipantRole` (Task 6); `getMyFamilies` for admin detection.
- Produces: `ParticipantsSection({ eventId, canAdmin }: { eventId: string; canAdmin: boolean })`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/events/__tests__/ParticipantsSection.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ParticipantsSection } from "@/components/events/ParticipantsSection";

vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
const participants = [
  { personId: "p1", displayName: "Active One", role: "PARTICIPANT", status: "ACTIVE" },
  { personId: "p2", displayName: "Revoked Two", role: "EVENT_ADMIN", status: "REVOKED" }
];
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { participants }, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() })
}));
vi.mock("@/lib/api/events", () => ({ listParticipants: vi.fn(), revokeParticipant: vi.fn(), setParticipantRole: vi.fn() }));

describe("ParticipantsSection", () => {
  it("lists participants and shows Revoke only for admins on active grants", () => {
    render(<ParticipantsSection eventId="e1" canAdmin={true} />);
    expect(screen.getByText("Active One")).toBeInTheDocument();
    expect(screen.getByText("Revoked Two")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /revoke/i }).length).toBe(1);
  });

  it("hides admin controls when canAdmin is false", () => {
    render(<ParticipantsSection eventId="e1" canAdmin={false} />);
    expect(screen.queryByRole("button", { name: /revoke/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `apps/web`): `npx vitest run components/events/__tests__/ParticipantsSection.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement `ParticipantsSection`**

Create `apps/web/components/events/ParticipantsSection.tsx`:

```tsx
"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listParticipants, revokeParticipant, setParticipantRole, type ParticipantRecord } from "@/lib/api/events";

export function ParticipantsSection({ eventId, canAdmin }: { eventId: string; canAdmin: boolean }) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["participants", eventId], queryFn: () => listParticipants(eventId, getToken) });

  const revoke = useMutation({
    mutationFn: (personId: string) => revokeParticipant(eventId, personId, getToken),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["participants", eventId] })
  });
  const setRole = useMutation({
    mutationFn: ({ personId, role }: { personId: string; role: "PARTICIPANT" | "EVENT_ADMIN" }) => setParticipantRole(eventId, personId, role, getToken),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["participants", eventId] })
  });

  if (isLoading) return null;
  const participants: ParticipantRecord[] = data?.participants ?? [];
  if (participants.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Participants</p>
      {participants.map((p) => (
        <div key={p.personId} className="flex items-center justify-between rounded-md px-3 py-2"
             style={{ border: "1px solid var(--border)", background: "var(--bg-card)", opacity: p.status === "REVOKED" ? 0.5 : 1 }}>
          <span className="text-sm" style={{ color: "var(--text-primary)" }}>
            {p.displayName} <span className="text-xs" style={{ color: "var(--text-muted)" }}>· {p.role === "EVENT_ADMIN" ? "admin" : "participant"}{p.status === "REVOKED" ? " · revoked" : ""}</span>
          </span>
          {canAdmin && p.status === "ACTIVE" && (
            <span style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setRole.mutate({ personId: p.personId, role: p.role === "EVENT_ADMIN" ? "PARTICIPANT" : "EVENT_ADMIN" })} className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {p.role === "EVENT_ADMIN" ? "Make participant" : "Make admin"}
              </button>
              <button onClick={() => revoke.mutate(p.personId)} className="text-xs" style={{ color: "var(--danger, #dc2626)" }}>Revoke</button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Mount in the member view with event-scoped admin detection**

In `apps/web/app/(protected)/events/[eventId]/page.tsx`, add a `getMyFamilies` query and derive `canAdmin` from the **event's** family, then mount the section in the details tab (after the items block, ~line 149):

```tsx
import { getMyFamilies } from "@/lib/api/family";
import { ParticipantsSection } from "@/components/events/ParticipantsSection";
```

```tsx
  const { data: families } = useQuery({ queryKey: ["families"], queryFn: () => getMyFamilies(getToken) });
  // computed after the member-narrowed `event` is in scope:
  const myMembership = (families ?? []).find((f) => f.familyGroup.id === event.familyGroupId);
  const canAdmin = (myMembership?.roles ?? []).some((r) => r === "ADMIN" || r === "ORGANIZER");
```

```tsx
          <ParticipantsSection eventId={eventId} canAdmin={canAdmin} />
```

(Place the `useQuery` for families with the other hooks near the top of the component — hooks must not be conditional. Compute `myMembership`/`canAdmin` after `event` is narrowed in the member branch. Leave the existing `isOrganizer = true` tab stub as-is; this `canAdmin` governs only the participant controls.)

- [ ] **Step 5: Run the component test + typecheck**

Run (from `apps/web`): `npx vitest run components/events/__tests__/ParticipantsSection.test.tsx` then `npm run type-check`.
Expected: PASS / no type errors.

- [ ] **Step 6: Lint + commit**

Run (from `apps/web`): `npm run lint`.

```bash
git add apps/web/components/events/ParticipantsSection.tsx apps/web/components/events/__tests__/ParticipantsSection.test.tsx "apps/web/app/(protected)/events/[eventId]/page.tsx"
git commit -m "feat: P3-03 add participant management to owning-member event view"
```

---

## Final Verification (after all tasks)

- [ ] Full API suite (from `apps/api`): `npx vitest run` → green.
- [ ] Full web suite (from `apps/web`): `npx vitest run` → green.
- [ ] Repo root: `npm run type-check` and `npm run lint` across workspaces → 0 errors.
- [ ] `git diff --check` → clean.
- [ ] `mcp__gitnexus.detect_changes` vs `main` → only expected symbols/flows changed.
- [ ] Manual smoke (dev): OPEN event → invite external email → confirm a `guest_invitation_delivery` log line; invite a cross-family suggestion as admin → open the accept link in a second account → accept → land on the event; decline then re-open the link → re-accept (revival); revoke from the member view → the link then shows "no longer available".
- [ ] Update `docs/FamLink_Current_State.md` (status, commits, verification baseline, next step) and re-run `npx gitnexus analyze`.

---

## Self-Review (performed during planning)

- **Spec coverage:** §3.1 preview → Task 3; §3.2 participants → Task 4; §3.3 accept/revival → Task 2; §3.4 guest delivery → Task 1; foreign-item ownership enabler (implicit in §4.3 add/edit-own/delete-own) → Task 5; §4.1 invite page → Task 7; §4.2 accept page → Task 8; §4.3 foreign viewer + contribution → Task 9; §4.3 member participant mgmt → Task 10; §4.4 client → Task 6; §5 isolation → enforced/asserted in Tasks 1/3/4/5/9; §6 bulk import → deferred (no task, by design). No uncovered requirement.
- **Placeholders:** none — every code/test step carries real content.
- **Type consistency:** `InviteeEntry`, `ParticipationPreview`/`ParticipationState`, `ParticipantRecord`, `ForeignEventItem`, `ForeignEventDTO`, `isForeignEventDTO` defined in Task 6 and consumed unchanged in Tasks 7–10; preview `state` values match the API (Task 3); `previewParticipation(token, getToken)` matches `apiFetch`'s required `getToken`; `foreignItemShape`'s new `isOwn` (Task 5) flows into `ForeignEventItem` (Task 6) and the `isOwn`-scoped delete (Task 9).
- **Council round-2 fixes applied:** participants gate = owning-member-only (BLOCKER); preview auth/relative-path (BLOCKER); preview 400/403 contract (BLOCKER); Task 5 `isOwn` enabler so Task 9 truly implements own-task controls (MAJOR); admin detection via the real `roles[]` keyed to the event's family (MAJOR×2); ACTIVE preview returns `{state,eventId}` only, contract aligned (MAJOR); AcceptClient test resets `mockPreview` (MINOR); guest-copy test asserts the seeded family NAME is absent rather than banning the word (MINOR).
- **Remaining execution-time confirmation (one, with fallback):** Clerk middleware coverage of `/events/accept` (Task 8 Step 4) — concrete instruction to add it to the matcher if absent.
