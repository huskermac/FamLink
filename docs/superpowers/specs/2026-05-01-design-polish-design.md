# Design Polish — Spec
**Date:** 2026-05-01
**Phase:** P2 (design refinement pass)
**Status:** Draft — pending user review

---

## Overview

A cohesive visual refresh of the FamLink web app. Three goals: (1) introduce a proper light/dark theme system driven by system preference with a user override, (2) standardise all components on CSS custom properties so both themes work everywhere, and (3) extend the Event data model with `eventType` and `visibility` fields to support color-coded cards and access control. Two follow-on specs are stubbed at the end.

---

## Section 1 — Theme System

### Approach

CSS custom properties on `:root` provide all color values. Light is the default. Dark overrides are applied via two mechanisms in `globals.css`:

```css
/* System preference */
@media (prefers-color-scheme: dark) { :root { ... } }

/* Manual override — wins over media query */
[data-theme="light"] { ... }
[data-theme="dark"]  { ... }
```

A `ThemeProvider` client component wraps the `(protected)` layout. On mount it reads `localStorage` key `famlink-theme` (`'system' | 'light' | 'dark'`), applies `data-theme` to `<html>`, and exposes a `setTheme` context setter. When in `system` mode it also listens for `prefers-color-scheme` changes and re-applies. Default value is `system` (no localStorage entry).

Preference is stored in `localStorage` only — no backend changes. Cross-device persistence is a future concern.

### Token Set

| Token | Light | Dark |
|---|---|---|
| `--bg-page` | `#f8fafc` | `#1e293b` |
| `--bg-sidebar` | `#f1f5f9` | `#0f172a` |
| `--bg-card` | `#ffffff` | `#0f172a` |
| `--border` | `#e2e8f0` | `#334155` |
| `--text-primary` | `#1e293b` | `#e2e8f0` |
| `--text-secondary` | `#94a3b8` | `#94a3b8` |
| `--text-muted` | `#64748b` | `#475569` |
| `--accent` | `#6366f1` | `#6366f1` |
| `--sidebar-active-bg` | `#e0e7ff` | `#1e293b` |
| `--sidebar-active-text` | `#4338ca` | `#e2e8f0` |

### Event Type Accent Colors (theme-invariant)

Accent bar and badge colors are the same in both themes. Badge backgrounds adapt (light pastel in light mode, deep tint in dark mode).

| Event Type | Bar color | Light badge bg / text | Dark badge bg / text |
|---|---|---|---|
| Holiday | `#ef4444` | `#fee2e2` / `#b91c1c` | `#450a0a` / `#fca5a5` |
| Birthday | `#a78bfa` | `#ede9fe` / `#7c3aed` | `#2e1065` / `#c4b5fd` |
| Sports | `#22c55e` | `#dcfce7` / `#15803d` | `#052e16` / `#86efac` |
| School | `#f59e0b` | `#fef3c7` / `#b45309` | `#431407` / `#fcd34d` |
| Other | `#94a3b8` | `#f1f5f9` / `#64748b` | `#1e293b` / `#94a3b8` |

---

## Section 2 — Component Updates

All hardcoded hex values and Tailwind color classes are replaced with CSS var references. No layout changes in this section.

**Files affected:**

- `apps/web/app/globals.css` — add all token definitions (light defaults + dark overrides)
- `apps/web/components/nav/NavShell.tsx` — replace inline hex with CSS vars
- `apps/web/components/nav/Sidebar.tsx` — same
- `apps/web/components/nav/Breadcrumbs.tsx` — text colors to CSS vars
- `apps/web/components/events/EventCard.tsx` — redesigned (see below)
- All `app/(protected)/*/page.tsx` files — background and heading colors to CSS vars

**EventCard redesign:**

New visual treatment — left accent bar (3px) colored by `eventType`, white/dark card body, type badge in top-right corner. Card structure:

```
[accent bar] | Title                    [Type badge]
             | Date · Location
```

Badge uses a pastel background in light mode and a deep tint in dark mode, both derived from the accent color.

---

## Section 3 — Settings Page

**Route:** `/settings` (protected)

**Entry point:** Gear icon (⚙️) added to the sidebar footer, right of the user name.

**Page content (v1):**

One section — Appearance. A three-way segmented control:

```
[ System ]  [ Light ]  [ Dark ]
```

Selecting an option calls `setTheme` from `ThemeProvider` context and writes to `localStorage`. No save button — changes apply immediately. `System` is the pre-selected default when no preference is stored.

No other settings in v1. The page is intentionally minimal — a placeholder for future preference settings.

---

## Section 4 — Event Data Model Extensions

> **Note:** This section was confirmed after a checkpoint discussion on 2026-05-01 to capture all new event attributes before implementation begins.

### 4a — `eventType` Enum

Add to the `Event` Prisma model:

```prisma
enum EventType {
  HOLIDAY
  BIRTHDAY
  SPORTS
  SCHOOL
  OTHER
}
```

- Default: `OTHER`
- Migration: existing events with `isBirthdayEvent = true` migrate to `BIRTHDAY`; all others to `OTHER`
- `isBirthdayEvent` column is retained and kept in sync for backwards API compatibility; mark as deprecated in schema comments

**API:** `EventSummary` gains `eventType: EventType`. Create/update endpoints accept it.

**Create-event form:** Type picker added — five options, each with a color dot matching the accent color. Defaults to `OTHER`.

### 4b — `visibility` Enum

```prisma
enum EventVisibility {
  BROADCAST   // visible to all family members; no invite required
  OPEN        // invite-based; invitees can forward; organizer notified on forward
  PRIVATE     // invite-based; invitees can request organizer invite someone else
}
```

- Default: `BROADCAST`
- No invitation management UI in this spec — `visibility` field is added to the model and exposed in the API; full invite flow is covered in P2-12

**Create-event form:** Visibility picker added alongside the type picker. Clear labels:
- **Broadcast** — "Everyone in the family sees this"
- **Open** — "Invited guests; they can bring others"
- **Private** — "Invited guests only"

---

## Section 5 — Empty States

Simple, consistent empty states across all pages. No illustrations in v1 — text + action link only.

| Page | Empty state message | Action |
|---|---|---|
| Events | "No events in the next {n} days." | Create Event button |
| Family | "You haven't joined a family yet." | Link to /onboarding |
| Calendar | "No events to show." | — |
| AI Assistant | Existing suggested prompts serve as empty state | No change |

---

## Stub: P2-12 — Event Invitations

> Full brainstorm pending. Key decisions captured here for sequencing.

**Scope:** Invitation delivery, forwarding, and identity resolution.

- **Open events:** invitee forwards to anyone; organizer notified automatically; forward target may be inside or outside FamLink
- **Private events:** invitees can send organizer a request to invite a specific person; organizer approves/ignores
- **Identity resolution:** on invite by email/phone, system checks for existing FamLink user (any family); if found, links invitation to their identity; if not, creates an anonymous `EventAttendee` record with a guest token (magic link RSVP, no account required)
- **Delivery:** email via Resend, SMS via Twilio (both already in stack)
- **Guest token:** `GUEST_TOKEN_SECRET` already in API env — anticipated from the start

**Depends on:** P2-13 (relationship graph powers invite suggestions)

---

## Stub: P2-13 — Social Relationship Graph

> Full brainstorm pending. Key decisions captured here for sequencing.

**Scope:** Extended and temporal relationships between persons (family members and external contacts).

**Core use case:** Boyfriend/girlfriend invited to family events. Relationship tracked, invite suggested when relevant family member is invited.

**Key decisions made:**
- Full relationship history retained (with start/end dates and status)
- **Forget option:** user can expunge a specific relationship record; privacy-sensitive — implementation must decide hard vs. soft delete
- **Status lifecycle:** e.g., dating → engaged → married; or dating → ended. Full transition history retained
- **Authorship:** any family member can add a relationship for any person; initiator chooses **notify** (subject gets a notification and can dispute/remove) or **silent** (no notification)
- **Relationship target:** can be a FamLink member (any family) or an anonymous external contact (email/phone)

**Powers:** invite suggestions in P2-12; future family graph/tree visualization (color coding for relationship types should reuse the event-type palette — confirmed 2026-05-01)

**Depends on:** nothing; foundational — should be sequenced before P2-12

---

## Out of Scope

- Icon library migration (emoji icons remain for now)
- Mobile app theming
- Cross-device theme sync (localStorage only)
- Full invitation UI (P2-12)
- Relationship management UI (P2-13)
