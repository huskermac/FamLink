# Web Navigation Shell Design

> **For agentic workers:** Use `superpowers:writing-plans` to turn this spec into an implementation plan.

**Goal:** Add a persistent navigation shell to all protected web pages — a collapsible left sidebar — with the structure in place to switch to a top nav bar per user preference in the future.

**Architecture:** A central `NAV_ITEMS` config drives all nav rendering. A `NavContext` holds the current orientation (`"sidebar" | "topnav"`), defaulting to `"sidebar"`. A `NavShell` component reads orientation and renders either `Sidebar` or `TopNav`. Both components share the same `NAV_ITEMS` data and the same `NavItem` type. The protected layout is updated to wrap all pages in `NavShell`.

**Tech stack:** Next.js App Router, React context, Tailwind CSS, `usePathname` for active-route detection.

---

## Nav Config (`apps/web/lib/nav.ts`)

Single source of truth for all nav items. Changing a label, icon, href, or sub-item is a one-line edit here with no component changes required.

```ts
export interface NavItem {
  label: string;
  href: string;
  icon: string;        // emoji for now — easily swapped for an icon library later
  children?: NavItem[];
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard",    href: "/dashboard",  icon: "⊞" },
  { label: "Events",       href: "/events",     icon: "📅",        children: [] },
  { label: "Family",       href: "/family",     icon: "👨‍👩‍👧", children: [] },
  { label: "Calendar",     href: "/calendar",   icon: "🗓" },
  { label: "AI Assistant", href: "/assistant",  icon: "✦" },
];
```

- Items where `children` exists **and** `children.length > 0` get collapsible/dropdown behavior.
- Items where `children` is absent **or** `children.length === 0` render as plain links.
- `children: []` in the config is a slot marker — it signals "this item will have sub-items" without affecting rendering until items are added.
- Sub-items follow the same `NavItem` shape, so nesting is recursive if ever needed.

---

## NavContext (`apps/web/contexts/NavContext.tsx`)

Holds orientation state. When a user-preference feature is built later, this is the single wiring point — read preference from user settings, set it here, all components respond automatically.

```ts
type NavOrientation = "sidebar" | "topnav";

interface NavContextValue {
  orientation: NavOrientation;
  setOrientation: (o: NavOrientation) => void;
}
```

- Default orientation: `"sidebar"`.
- `NavProvider` wraps the protected layout.
- Components read orientation via `useNavOrientation()` hook exported from this file.

---

## Sidebar (`apps/web/components/nav/Sidebar.tsx`)

Renders the left sidebar using the approved working style.

**Layout:**
- Fixed width: `200px`
- Full viewport height: `min-h-screen`
- Background: `#0f172a`
- Logo area at top (FamLink, indigo accent), border-bottom
- Nav items in a scrollable middle section
- Signed-in user's first name pinned to the bottom, border-top

**Nav item behavior:**
- Items without `children`: plain `<Link>` with icon + label. Active when `pathname === item.href`.
- Items with `children`: clickable header row with icon, label, and a chevron. `useState` tracks open/closed per item. Chevron rotates on toggle.
- **Auto-expand:** On mount, any item whose `href` is a prefix of the current `pathname` opens automatically (e.g., navigating to `/events/123` opens the Events section).
- **Active styling:** Active item text `#e2e8f0`, background `#1e293b`. Default text `#94a3b8`. Sub-items indented to `40px` left padding, default text `#64748b`.

**Approved colors (working style, not final):**
| Element | Value |
|---|---|
| Sidebar bg | `#0f172a` |
| Content/active item bg | `#1e293b` |
| Accent (logo, active indicator) | `#6366f1` |
| Primary text | `#e2e8f0` |
| Muted nav text | `#94a3b8` |
| Sub-item text | `#64748b` |

---

## TopNav (`apps/web/components/nav/TopNav.tsx`)

Stub implementation. Renders a horizontal `<nav>` bar across the top with the logo and nav item labels. Items with `children` show a dropdown panel on click (collapsed by default). The dropdown is visually minimal — enough to be functional, no styling effort spent on it until the orientation feature is formally built.

The `NavItem` shape already supports dropdowns — no future data-model changes needed.

---

## NavShell (`apps/web/components/nav/NavShell.tsx`)

Reads orientation from `NavContext`. Renders either `<Sidebar>` or `<TopNav>`, then places `children` in the main content area.

```tsx
// Sidebar orientation layout
<div className="flex min-h-screen">
  <Sidebar />
  <main className="flex-1 overflow-y-auto">{children}</main>
</div>

// TopNav orientation layout
<div className="flex flex-col min-h-screen">
  <TopNav />
  <main className="flex-1 overflow-y-auto">{children}</main>
</div>
```

---

## Protected Layout (`apps/web/app/(protected)/layout.tsx`)

Replace the current `QueryProvider`-only wrapper:

```tsx
export default function ProtectedLayout({ children }) {
  return (
    <QueryProvider>
      <NavProvider>
        <NavShell>{children}</NavShell>
      </NavProvider>
    </QueryProvider>
  );
}
```

---

## Out of Scope

- User-configurable orientation preference (storage, settings UI) — the wiring point is ready, not the feature.
- Populated sub-nav items — `children: []` slots are in place; content added per-feature in future phases.
- Mobile responsive / hamburger menu — deferred to design polish phase.
- Icon library swap — emoji used now; slot is ready for a proper icon set.
- Active sub-item highlighting — parent section highlights only; sub-item active state deferred.
