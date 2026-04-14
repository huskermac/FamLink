# FamLink — Session Checkpoint
**Date:** April 14, 2026
**Phase:** 2
**Session scope:** P2-06 Event Hub UI + P2-07 Calendar UI

---

## Where We Left Off

**Last completed prompt:** P2-07 — Frontend: Calendar UI (Web)
**Next prompt:** P2-08 — Frontend: AI Assistant UI (Web)
**Working tree:** Clean — no untracked or modified files.

---

## Phase 2 Commit Log (as of this checkpoint)

| Commit | Description |
|---|---|
| `c0909dc` | feat: P2-07 Calendar UI |
| `f246037` | feat: P2-06 Event Hub UI |
| `b8f3ec3` | chore: housekeeping — commit untracked docs, CLAUDE.md, gitignore fixes |
| `a9fa8d3` | feat: P2-05 Frontend Family Graph UI |
| `2e8f4f1` | feat: P2-04 Socket.io real-time push (event:created + rsvp:updated) |
| `5685b8c` | feat: P2-03b Schema Pre-Migration – rename PotluckAssignment to EventItem |
| `3a3fb22` | feat: P2-03 AI Assistant API + Layer 1 Tools + Helicone |
| `7d6e220` | feat: P2-02 AI Context Assembler |

---

## What Was Built This Session

### P2-06 — Event Hub UI
- Recovered partially-built, uncommitted work from prior session. Audited against spec, kept all code, filled gaps.
- **Pages:** `app/(protected)/events/page.tsx`, `events/[eventId]/page.tsx`, `events/new/page.tsx`
- **Components:** `EventCard`, `RsvpButton`, `EventConfirmationCard`, `OrganizerDashboard`
- **Lib:** `lib/api/events.ts`, `lib/socket.ts`, `lib/socketTypes.ts`
- **Tests:** 4 test files — 36 tests, all passing
- **Fixes applied:** unused imports, wrong generic on `useSocketEvent<"event:created">`, unused `userId` variable

### P2-07 — Calendar UI
- Fresh build from spec.
- **Page:** `app/(protected)/calendar/page.tsx`
- **Components:** `CalendarView` (react-big-calendar wrapper), `BirthdayPopover`, `UpcomingDigest`
- **Lib:** `lib/api/calendar.ts` — maps `isBirthdayEvent` to `CalendarEventType` discriminant
- **Deps installed:** `react-big-calendar@1.19.4`, `date-fns@4.1.0`, `@types/react-big-calendar`
- **Tests:** 3 test files — 50 total tests passing
- **Known limitation:** `BirthdayPopover` age display requires person DOB, which the calendar API does not currently return. Popover shows name only in production; tests pass a hard-coded age.

---

## Test State

| Package | Tests | Status |
|---|---|---|
| `famlink-web` | 50 | ✅ All passing |
| `famlink-api` | (unchanged from P2-03) | ✅ Passing |

`turbo type-check` — zero errors across all packages.

---

## P2-08 Context (to brief the next session)

**Objective:** AI Assistant chat UI — streaming interface, tool result cards, `EventConfirmationCard` integration, daily query limit display.

**Key dependencies:**
- Depends on P2-03 (AI Assistant API — streaming `POST /api/v1/ai/chat`) and P2-06 (EventConfirmationCard)
- Install in `apps/web`: `ai` (Vercel AI SDK) and `@ai-sdk/react` for the `useChat` hook
- **Important:** FamLink runs on Railway, not Vercel. The AI endpoint is proxied through a Next.js route handler (`app/api/ai/chat/route.ts`) to the Express API — do NOT use Vercel AI Gateway.
- `useChat` connects to `/api/ai/chat` (Next.js proxy), body includes `{ familyGroupId }`
- `create_event` tool returns a proposal — UI must render `EventConfirmationCard` and call `createEvent` on confirm
- 20-query daily limit must be surfaced with a `RateLimitBadge` component

**Files to create (per spec):**
- `app/(protected)/assistant/page.tsx`
- `app/api/ai/chat/route.ts` (Next.js proxy route handler to Express)
- `components/assistant/ChatInput.tsx`
- `components/assistant/MessageBubble.tsx`
- `components/assistant/RateLimitBadge.tsx`
- `components/assistant/ToolResultCard.tsx`
- Test files in `src/components/assistant/__tests__/` and `src/app/(protected)/assistant/__tests__/`

**ADR note:** Consult ADR v0.4 §ADR-06 before building. The AI propose/confirm guardrail (create_event) is a core constraint — `EventConfirmationCard.onConfirm` calls `createEvent`, not the AI layer.

---

## Resumption Instructions

To resume, open a new session in this repo and say:

> "Resume Phase 2. Last completed was P2-07. Next is P2-08 — AI Assistant UI. Check this checkpoint doc at `docs/FamLink_Session_Checkpoint_2026-04-14.md` and the ADR at `docs/FamLink_ADR_v0_4.md` before starting."

---

*Checkpoint created April 14, 2026 — working tree clean, all tests passing.*
