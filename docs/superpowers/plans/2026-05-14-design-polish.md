# Design Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cohesive visual refresh of the FamLink web app: CSS custom property token system, light/dark theme with system-preference following, EventCard redesign with `eventType` color coding, Settings page with theme toggle, and empty states across all content pages.

**Spec:** `docs/superpowers/specs/2026-05-01-design-polish-design.md`

**Architecture:**
- CSS custom properties on `:root` provide all color values. Light tokens are defaults; dark overrides use `@media (prefers-color-scheme: dark)` + `[data-theme="dark"]` attribute wins over the media query. `[data-theme="light"]` forces light even when OS is dark.
- A `ThemeProvider` client component wraps the protected layout. It reads `localStorage` key `famlink-theme` on mount, writes `data-theme` to `document.documentElement`, and exposes a `setTheme` context setter.
- The Event model gains two new Prisma enum fields: `eventType EventType @default(OTHER)` and `eventVisibility EventVisibility @default(BROADCAST)`. Note: the existing `visibility: String` field (values: FAMILY/HOUSEHOLD/etc.) controls view access and is **kept as-is**. The new `eventVisibility` field uses the new enum and controls invitation semantics (BROADCAST/OPEN/PRIVATE) for P2-12. The field name `eventVisibility` (not `visibility`) avoids the collision with the existing field.
- All inline hex values and Tailwind color classes in nav components and page files are replaced with `var(--token)` references so both themes work.

**Tech Stack:** Next.js App Router, React context, Prisma, CSS custom properties, Zod, Vitest

---

## File Map

| Status | Path | Purpose |
|--------|------|---------|
| Modify | `packages/db/prisma/schema.prisma` | Add `EventType` + `EventVisibility` enums; add `eventType` + `eventVisibility` to `Event` |
| Modify | `apps/api/src/routes/events.ts` | Add `eventType` + `eventVisibility` to create/update Zod schemas |
| Modify | `apps/web/lib/api/events.ts` | Add `eventType` + `eventVisibility` to `EventSummary`, `EventRecord`, `CreateEventData` |
| Modify | `apps/web/app/globals.css` | Full CSS token set — light defaults + dark overrides |
| Create | `apps/web/contexts/ThemeContext.tsx` | `ThemeProvider` + `useTheme` hook |
| Modify | `apps/web/app/(protected)/layout.tsx` | Wrap children in `ThemeProvider` |
| Modify | `apps/web/components/nav/Sidebar.tsx` | Replace hex with CSS vars; add gear icon to footer |
| Modify | `apps/web/components/nav/NavShell.tsx` | Replace hardcoded bg with CSS vars |
| Modify | `apps/web/components/nav/Breadcrumbs.tsx` | Replace hex with CSS vars |
| Modify | `apps/web/components/nav/TopNav.tsx` | Replace hex with CSS vars |
| Modify | `apps/web/app/(protected)/dashboard/page.tsx` | CSS vars for bg/heading colors |
| Modify | `apps/web/app/(protected)/events/page.tsx` | CSS vars + empty state |
| Modify | `apps/web/app/(protected)/events/new/page.tsx` | CSS vars + eventType/eventVisibility pickers |
| Modify | `apps/web/app/(protected)/events/[eventId]/page.tsx` | CSS vars |
| Modify | `apps/web/app/(protected)/family/page.tsx` | CSS vars + empty state |
| Modify | `apps/web/app/(protected)/family/[familyId]/page.tsx` | CSS vars |
| Modify | `apps/web/app/(protected)/family/[familyId]/members/[personId]/page.tsx` | CSS vars |
| Modify | `apps/web/app/(protected)/calendar/page.tsx` | CSS vars + empty state |
| Modify | `apps/web/app/(protected)/assistant/page.tsx` | CSS vars |
| Modify | `apps/web/components/events/EventCard.tsx` | Redesign: left accent bar + type badge |
| Create | `apps/web/app/(protected)/settings/page.tsx` | Settings page with theme segmented control |
| Modify | `apps/web/lib/nav.ts` | Add Settings entry |

---

### Task 1: DB schema — EventType + EventVisibility

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add enums and fields**

Add after the existing `EventItemVisibility` enum:

```prisma
enum EventType {
  HOLIDAY
  BIRTHDAY
  SPORTS
  SCHOOL
  OTHER
}

enum EventVisibility {
  BROADCAST
  OPEN
  PRIVATE
}
```

Add to the `Event` model, after `isBirthdayEvent Boolean @default(false)`:

```prisma
  // @deprecated — kept for backwards API compatibility; use eventType instead
  isBirthdayEvent   Boolean         @default(false)
  birthdayPersonId  String?
  eventType         EventType       @default(OTHER)
  eventVisibility   EventVisibility @default(BROADCAST)
```

- [ ] **Step 2: Generate and run migration**

```bash
cd packages/db
npx prisma migrate dev --name add_event_type_visibility
```

Expected: migration created and applied. Review the generated SQL to confirm the two new columns and that the existing `visibility` String column is untouched.

- [ ] **Step 3: Backfill isBirthdayEvent → BIRTHDAY**

After the migration runs, apply the backfill. From `packages/db/`:

```bash
npx prisma db execute --stdin <<'SQL'
UPDATE "Event"
SET "eventType" = 'BIRTHDAY'
WHERE "isBirthdayEvent" = true AND "eventType" = 'OTHER';
SQL
```

- [ ] **Step 4: Regenerate Prisma client**

```bash
npx prisma generate
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat: add EventType and EventVisibility enums to Event model"
```

---

### Task 2: API schema + web types

**Files:**
- Modify: `apps/api/src/routes/events.ts`
- Modify: `apps/web/lib/api/events.ts`

- [ ] **Step 1: Update API Zod schemas**

In `apps/api/src/routes/events.ts`, add to `BaseEventFieldsSchema`:

```ts
const eventTypeEnum = z.enum(["HOLIDAY", "BIRTHDAY", "SPORTS", "SCHOOL", "OTHER"]);
const eventVisibilityEnum = z.enum(["BROADCAST", "OPEN", "PRIVATE"]);

const BaseEventFieldsSchema = z.object({
  // ... existing fields ...
  eventType: eventTypeEnum.optional().default("OTHER"),
  eventVisibility: eventVisibilityEnum.optional().default("BROADCAST"),
});
```

Make sure the create handler passes `eventType` and `eventVisibility` to the Prisma `db.event.create()` call.

- [ ] **Step 2: Update web API types**

In `apps/web/lib/api/events.ts`:

```ts
export type EventType = "HOLIDAY" | "BIRTHDAY" | "SPORTS" | "SCHOOL" | "OTHER";
export type EventVisibility = "BROADCAST" | "OPEN" | "PRIVATE";

export interface EventSummary {
  id: string;
  familyGroupId: string;
  createdByPersonId?: string;
  title: string;
  startAt: string;
  endAt: string | null;
  locationName: string | null;
  locationAddress?: string | null;
  isBirthdayEvent: boolean;
  eventType: EventType;
  eventVisibility: EventVisibility;
}

export interface EventRecord {
  // ... existing fields ...
  eventType: EventType;
  eventVisibility: EventVisibility;
}

export interface CreateEventData {
  title: string;
  startAt: string;
  endAt?: string;
  locationName?: string;
  locationAddress?: string;
  description?: string;
  visibility?: string;
  eventType?: EventType;
  eventVisibility?: EventVisibility;
}
```

- [ ] **Step 3: Verify TypeScript across packages**

```bash
cd apps/api && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/events.ts apps/web/lib/api/events.ts
git commit -m "feat: add eventType and eventVisibility to events API"
```

---

### Task 3: CSS token system

**Files:**
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Replace globals.css**

```css
@import 'react-big-calendar/lib/css/react-big-calendar.css';

@tailwind base;
@tailwind components;
@tailwind utilities;

/* ── Light tokens (default) ─────────────────────────────────── */
:root {
  --bg-page:            #f8fafc;
  --bg-sidebar:         #f1f5f9;
  --bg-card:            #ffffff;
  --border:             #e2e8f0;
  --text-primary:       #1e293b;
  --text-secondary:     #94a3b8;
  --text-muted:         #64748b;
  --accent:             #6366f1;
  --sidebar-active-bg:  #e0e7ff;
  --sidebar-active-text:#4338ca;
}

/* ── Dark tokens — system preference ───────────────────────── */
@media (prefers-color-scheme: dark) {
  :root {
    --bg-page:            #1e293b;
    --bg-sidebar:         #0f172a;
    --bg-card:            #0f172a;
    --border:             #334155;
    --text-primary:       #e2e8f0;
    --text-secondary:     #94a3b8;
    --text-muted:         #475569;
    --accent:             #6366f1;
    --sidebar-active-bg:  #1e293b;
    --sidebar-active-text:#e2e8f0;
  }
}

/* ── Manual overrides — win over media query ────────────────── */
[data-theme="light"] {
  --bg-page:            #f8fafc;
  --bg-sidebar:         #f1f5f9;
  --bg-card:            #ffffff;
  --border:             #e2e8f0;
  --text-primary:       #1e293b;
  --text-secondary:     #94a3b8;
  --text-muted:         #64748b;
  --accent:             #6366f1;
  --sidebar-active-bg:  #e0e7ff;
  --sidebar-active-text:#4338ca;
}

[data-theme="dark"] {
  --bg-page:            #1e293b;
  --bg-sidebar:         #0f172a;
  --bg-card:            #0f172a;
  --border:             #334155;
  --text-primary:       #e2e8f0;
  --text-secondary:     #94a3b8;
  --text-muted:         #475569;
  --accent:             #6366f1;
  --sidebar-active-bg:  #1e293b;
  --sidebar-active-text:#e2e8f0;
}

body {
  background-color: var(--bg-page);
  color: var(--text-primary);
}

main a {
  color: var(--accent);
}
main a:hover {
  opacity: 0.8;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "feat: CSS custom property token system — light/dark themes"
```

---

### Task 4: ThemeProvider

**Files:**
- Create: `apps/web/contexts/ThemeContext.tsx`
- Modify: `apps/web/app/(protected)/layout.tsx`

- [ ] **Step 1: Write ThemeContext.tsx**

```tsx
// apps/web/contexts/ThemeContext.tsx
"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";

interface ThemeContextValue {
  theme: ThemePreference;
  setTheme: (t: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "famlink-theme";

function applyTheme(pref: ThemePreference) {
  const el = document.documentElement;
  if (pref === "system") {
    el.removeAttribute("data-theme");
  } else {
    el.setAttribute("data-theme", pref);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>("system");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemePreference | null;
    const initial = stored ?? "system";
    setThemeState(initial);
    applyTheme(initial);

    if (initial === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyTheme("system");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, []);

  function setTheme(pref: ThemePreference) {
    setThemeState(pref);
    applyTheme(pref);
    if (pref === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, pref);
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
```

- [ ] **Step 2: Wrap protected layout**

```tsx
// apps/web/app/(protected)/layout.tsx
import { QueryProvider } from "@/components/QueryProvider";
import { NavProvider } from "@/contexts/NavContext";
import { NavShell } from "@/components/nav/NavShell";
import { ThemeProvider } from "@/contexts/ThemeContext";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <NavProvider>
          <NavShell>{children}</NavShell>
        </NavProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/contexts/ThemeContext.tsx apps/web/app/(protected)/layout.tsx
git commit -m "feat: ThemeProvider with localStorage + system-preference support"
```

---

### Task 5: Nav component migration to CSS vars

**Files:**
- Modify: `apps/web/components/nav/Sidebar.tsx`
- Modify: `apps/web/components/nav/NavShell.tsx`
- Modify: `apps/web/components/nav/Breadcrumbs.tsx`
- Modify: `apps/web/components/nav/TopNav.tsx`

**Token mapping guide:**
- `#0f172a` → `var(--bg-sidebar)`
- `#1e293b` → `var(--sidebar-active-bg)` (as active item bg) or `var(--bg-page)` (as page bg)
- `#334155` or `#1e293b` border → `var(--border)`
- `#6366f1` logo/accent → `var(--accent)`
- `#e2e8f0` active text → `var(--text-primary)`
- `#94a3b8` inactive text → `var(--text-secondary)`
- `#64748b` muted/sub text → `var(--text-muted)`
- `#4338ca` active link → `var(--sidebar-active-text)`
- Active item highlight bg `#1e293b` (in sidebar active item) → `var(--sidebar-active-bg)`

- [ ] **Step 1: Update Sidebar.tsx**

Replace every hardcoded hex in inline styles with the appropriate CSS var. The sidebar `<aside>` background becomes `var(--bg-sidebar)`. Logo color becomes `var(--accent)`. Divider borders become `var(--border)`. User name text becomes `var(--text-muted)`. In `NavItemRow`: active item background becomes `var(--sidebar-active-bg)`, active text becomes `var(--sidebar-active-text)`, inactive text `var(--text-secondary)`, depth-1 bullet color `var(--text-muted)`. ChevronIcon color becomes `var(--text-muted)`.

Also add the gear icon link to the settings page in the sidebar footer section:

```tsx
{/* User area */}
<div style={{
  padding: "12px 16px",
  borderTop: `1px solid var(--border)`,
  color: "var(--text-muted)",
  fontSize: "12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
}}>
  <span>{user?.firstName ?? ""}</span>
  <Link href="/settings" style={{ color: "var(--text-muted)", textDecoration: "none", fontSize: "16px" }}
    title="Settings">
    ⚙️
  </Link>
</div>
```

- [ ] **Step 2: Update NavShell.tsx**

Replace any hardcoded colors. The `<main>` content area background should be `var(--bg-page)`. Example:

```tsx
<main style={{ flex: 1, overflowY: "auto", background: "var(--bg-page)" }}>
```

Read the file before editing to make sure all inline styles are updated.

- [ ] **Step 3: Update Breadcrumbs.tsx**

Replace the hex text colors:
- `#475569` separator → `var(--text-muted)`
- `#94a3b8` current segment → `var(--text-secondary)`
- `#64748b` parent link → `var(--text-muted)`

- [ ] **Step 4: Update TopNav.tsx**

Apply the same token mapping: `#0f172a` → `var(--bg-sidebar)`, `#1e293b` border → `var(--border)`, `#6366f1` → `var(--accent)`, `#94a3b8` → `var(--text-secondary)`.

- [ ] **Step 5: Run existing nav tests**

```bash
cd apps/web && npx vitest run src/components/nav
```

Expected: all tests pass (tests mock hex values at render time, not theme-dependent).

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/nav/
git commit -m "feat: migrate nav components to CSS custom property tokens"
```

---

### Task 6: Page files migration to CSS vars

**Files:** All `apps/web/app/(protected)/*/page.tsx` files

**Pattern:** Replace Tailwind color classes (`text-slate-100`, `text-slate-400`, `bg-slate-800`, etc.) with inline `style` props using CSS vars. Match the token mapping:

| Tailwind class | CSS var |
|---|---|
| `text-slate-100` / `text-slate-50` | `var(--text-primary)` |
| `text-slate-300` / `text-slate-400` | `var(--text-secondary)` |
| `text-slate-500` / `text-slate-600` | `var(--text-muted)` |
| `bg-slate-800` / `bg-slate-900` / `bg-slate-950` | `var(--bg-card)` |
| `border-slate-600` / `border-slate-700` | `var(--border)` |
| `bg-indigo-600` CTA button | keep as-is (accent is theme-invariant) |

**Strategy:** Read each file, identify Tailwind color utility classes, convert to inline styles. Layout/spacing Tailwind classes (`p-6`, `flex`, `gap-3`, `rounded`, `font-semibold`, etc.) can stay as-is.

- [ ] **Step 1: Update dashboard/page.tsx**

Read the file. Convert color Tailwind classes to CSS var inline styles.

- [ ] **Step 2: Update events/page.tsx**

Heading `text-slate-100` → `style={{ color: "var(--text-primary)" }}`. Error text `text-red-400` → keep (always red). Day selector buttons already use inline styles — update `#94a3b8` → `var(--text-secondary)`, `#475569` border → `var(--border)`.

Also update the empty state (already has one but improve it per spec):

```tsx
{events.length === 0 && (
  <div style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
    <p>No events in the next {days} days.</p>
    <Link href="/events/new" style={{ color: "var(--accent)", marginTop: "8px", display: "inline-block" }}>
      Create an event →
    </Link>
  </div>
)}
```

- [ ] **Step 3: Update family/page.tsx**

Convert color classes. Empty state:

```tsx
{/* when no family */}
<p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
  You haven&apos;t joined a family yet.
</p>
<Link href="/onboarding" style={{ color: "var(--accent)", fontSize: "14px" }}>
  Get started with onboarding →
</Link>
```

- [ ] **Step 4: Update calendar/page.tsx**

Convert color classes. Empty state (when no events):

```tsx
<p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>No events to show.</p>
```

- [ ] **Step 5: Update remaining pages**

Apply the same token mapping to:
- `events/[eventId]/page.tsx`
- `family/[familyId]/page.tsx`
- `family/[familyId]/members/[personId]/page.tsx`
- `assistant/page.tsx`

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/(protected)/
git commit -m "feat: migrate page files to CSS custom property tokens + empty states"
```

---

### Task 7: EventCard redesign

**Files:**
- Modify: `apps/web/components/events/EventCard.tsx`

**Design:** Left accent bar (3px wide, `border-radius` on left side only), card body using `var(--bg-card)` + `var(--border)`, type badge in top-right.

**Accent color map** (theme-invariant — hardcode these values):

```ts
const EVENT_TYPE_CONFIG = {
  HOLIDAY:  { bar: "#ef4444", lightBg: "#fee2e2", lightText: "#b91c1c", darkBg: "#450a0a", darkText: "#fca5a5" },
  BIRTHDAY: { bar: "#a78bfa", lightBg: "#ede9fe", lightText: "#7c3aed", darkBg: "#2e1065", darkText: "#c4b5fd" },
  SPORTS:   { bar: "#22c55e", lightBg: "#dcfce7", lightText: "#15803d", darkBg: "#052e16", darkText: "#86efac" },
  SCHOOL:   { bar: "#f59e0b", lightBg: "#fef3c7", lightText: "#b45309", darkBg: "#431407", darkText: "#fcd34d" },
  OTHER:    { bar: "#94a3b8", lightBg: "#f1f5f9", lightText: "#64748b", darkBg: "#1e293b", darkText: "#94a3b8" },
} as const;
```

Badge background/text can't read CSS vars in JS — use `currentColor` trick or render two badge elements hidden by theme. The simpler approach: use a `data-theme`-aware CSS class, or just accept that badges use light-mode colors by default until dark mode is wired. Since we can't read CSS var values in JS, **use the light-mode badge colors always for now** and leave a TODO comment: `// TODO: use dark badge colors when dark theme is active — requires reading data-theme attribute`.

- [ ] **Step 1: Rewrite EventCard.tsx**

```tsx
import Link from "next/link";
import type { EventSummary, EventType } from "@/lib/api/events";

interface Props {
  event: EventSummary;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric"
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

const EVENT_TYPE_CONFIG: Record<EventType, {
  bar: string; badgeBg: string; badgeText: string; label: string;
}> = {
  HOLIDAY:  { bar: "#ef4444", badgeBg: "#fee2e2", badgeText: "#b91c1c", label: "Holiday" },
  BIRTHDAY: { bar: "#a78bfa", badgeBg: "#ede9fe", badgeText: "#7c3aed", label: "Birthday" },
  SPORTS:   { bar: "#22c55e", badgeBg: "#dcfce7", badgeText: "#15803d", label: "Sports" },
  SCHOOL:   { bar: "#f59e0b", badgeBg: "#fef3c7", badgeText: "#b45309", label: "School" },
  OTHER:    { bar: "#94a3b8", badgeBg: "#f1f5f9", badgeText: "#64748b", label: "Other" },
};

export function EventCard({ event }: Props) {
  const typeKey = event.eventType ?? "OTHER";
  const cfg = EVENT_TYPE_CONFIG[typeKey];

  return (
    <Link
      href={`/events/${event.id}`}
      style={{
        display: "flex",
        borderRadius: "8px",
        border: "1px solid var(--border)",
        background: "var(--bg-card)",
        textDecoration: "none",
        overflow: "hidden",
      }}
    >
      {/* Left accent bar */}
      <div style={{ width: "3px", flexShrink: 0, background: cfg.bar }} />

      {/* Card body */}
      <div style={{
        flex: 1,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
          <span style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.3 }}>
            {event.title}
          </span>
          {/* Type badge */}
          <span style={{
            flexShrink: 0,
            borderRadius: "9999px",
            background: cfg.badgeBg,
            color: cfg.badgeText,
            padding: "2px 8px",
            fontSize: "11px",
            fontWeight: 500,
          }}>
            {cfg.label}
          </span>
        </div>
        <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          {formatDate(event.startAt)} at {formatTime(event.startAt)}
        </span>
        {event.locationName && (
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{event.locationName}</span>
        )}
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Run full test suite**

```bash
cd apps/web && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/events/EventCard.tsx
git commit -m "feat: EventCard redesign — accent bar + type badge"
```

---

### Task 8: Create-event form — type and visibility pickers

**Files:**
- Modify: `apps/web/app/(protected)/events/new/page.tsx`

- [ ] **Step 1: Add state and picker UI**

Add `eventType` and `eventVisibility` state to the form:

```ts
const [eventType, setEventType] = useState<EventType>("OTHER");
const [eventVisibility, setEventVisibility] = useState<EventVisibility>("BROADCAST");
```

Add `eventType` to the `createEvent` call payload.

**Type picker** — add between the Title field and Start time field:

```tsx
<div className="flex flex-col gap-1">
  <label className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
    Event type
  </label>
  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
    {(["HOLIDAY","BIRTHDAY","SPORTS","SCHOOL","OTHER"] as const).map((t) => {
      const cfg = EVENT_TYPE_CONFIG[t];
      const selected = eventType === t;
      return (
        <button
          key={t}
          type="button"
          onClick={() => setEventType(t)}
          style={{
            padding: "4px 12px",
            borderRadius: "9999px",
            fontSize: "12px",
            fontWeight: 500,
            border: `2px solid ${selected ? cfg.bar : "var(--border)"}`,
            background: selected ? cfg.badgeBg : "transparent",
            color: selected ? cfg.badgeText : "var(--text-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "5px",
          }}
        >
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: cfg.bar, display: "inline-block" }} />
          {cfg.label}
        </button>
      );
    })}
  </div>
</div>
```

**Visibility picker** — add after the type picker:

```tsx
<div className="flex flex-col gap-1">
  <label className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
    Who can see this?
  </label>
  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
    {([
      { value: "BROADCAST" as const, label: "Broadcast", desc: "Everyone in the family sees this" },
      { value: "OPEN" as const,      label: "Open",      desc: "Invited guests; they can bring others" },
      { value: "PRIVATE" as const,   label: "Private",   desc: "Invited guests only" },
    ]).map(({ value, label, desc }) => (
      <label key={value} style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}>
        <input
          type="radio"
          name="eventVisibility"
          value={value}
          checked={eventVisibility === value}
          onChange={() => setEventVisibility(value)}
        />
        <span>
          <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)" }}>{label}</span>
          <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "6px" }}>{desc}</span>
        </span>
      </label>
    ))}
  </div>
</div>
```

Pass `eventType` and `eventVisibility` to `createEvent`:

```ts
const created = await createEvent(
  familyId,
  {
    // ... existing fields ...
    eventType,
    eventVisibility,
  },
  getToken
);
```

Import `EVENT_TYPE_CONFIG` from EventCard, or move the config to a shared location (e.g., `apps/web/lib/eventTypes.ts`) and import it in both EventCard and the new event form.

> **Note on shared config:** Extract `EVENT_TYPE_CONFIG` to `apps/web/lib/eventTypes.ts` and import it in both `EventCard.tsx` and `events/new/page.tsx`. This keeps the color definitions in one place.

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(protected)/events/new/page.tsx apps/web/lib/eventTypes.ts apps/web/components/events/EventCard.tsx
git commit -m "feat: event type and visibility pickers on create-event form"
```

---

### Task 9: Settings page

**Files:**
- Create: `apps/web/app/(protected)/settings/page.tsx`
- Modify: `apps/web/lib/nav.ts`

- [ ] **Step 1: Create settings page**

```tsx
// apps/web/app/(protected)/settings/page.tsx
"use client";

import { useTheme, type ThemePreference } from "@/contexts/ThemeContext";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light",  label: "Light" },
  { value: "dark",   label: "Dark" },
];

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();

  return (
    <div style={{ padding: "24px", maxWidth: "480px" }}>
      <h1 style={{ fontSize: "20px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "24px" }}>
        Settings
      </h1>

      <section>
        <h2 style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
          Appearance
        </h2>
        <div style={{
          display: "inline-flex",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          overflow: "hidden",
        }}>
          {THEME_OPTIONS.map(({ value, label }) => {
            const active = theme === value;
            return (
              <button
                key={value}
                onClick={() => setTheme(value)}
                style={{
                  padding: "8px 20px",
                  fontSize: "13px",
                  fontWeight: active ? 600 : 400,
                  background: active ? "var(--accent)" : "transparent",
                  color: active ? "#fff" : "var(--text-secondary)",
                  border: "none",
                  cursor: "pointer",
                  transition: "background 0.15s, color 0.15s",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Add Settings to nav config**

In `apps/web/lib/nav.ts`, add a Settings item:

```ts
{ label: "Settings", href: "/settings", icon: "⚙️" },
```

Add it after "AI Assistant" in `NAV_ITEMS`.

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/(protected)/settings/page.tsx apps/web/lib/nav.ts
git commit -m "feat: Settings page with theme toggle"
```

---

### Task 10: Full verification pass

- [ ] **Step 1: Run full web test suite**

```bash
cd apps/web && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 2: Start dev server and verify visually**

```bash
# from repo root
npm run dev --workspace=apps/web
```

Checklist:
- [ ] Light theme is default (page background is off-white, not dark slate)
- [ ] OS dark mode switches the theme when setting is "System"
- [ ] Settings page: switching to Dark forces dark; switching to Light forces light; System reverts to OS
- [ ] Preference persists on page refresh (localStorage)
- [ ] Sidebar: FamLink logo in indigo, active item highlighted, gear icon in footer links to /settings
- [ ] Events page: EventCards show left accent bar + type badge; colors match the type
- [ ] Create event form: type picker with color dots; visibility radio group
- [ ] Events empty state: "No events in the next N days." + Create Event link
- [ ] Family empty state appears when not in a family
- [ ] Calendar empty state appears when no events
- [ ] All pages readable in both light and dark mode (no black-on-black or white-on-white text)

- [ ] **Step 3: Commit summary**

```bash
git commit --allow-empty -m "chore: design polish P2 complete"
```

---

## Commit summary

| Task | Commit message |
|------|---------------|
| 1 | `feat: add EventType and EventVisibility enums to Event model` |
| 2 | `feat: add eventType and eventVisibility to events API` |
| 3 | `feat: CSS custom property token system — light/dark themes` |
| 4 | `feat: ThemeProvider with localStorage + system-preference support` |
| 5 | `feat: migrate nav components to CSS custom property tokens` |
| 6 | `feat: migrate page files to CSS custom property tokens + empty states` |
| 7 | `feat: EventCard redesign — accent bar + type badge` |
| 8 | `feat: event type and visibility pickers on create-event form` |
| 9 | `feat: Settings page with theme toggle` |
