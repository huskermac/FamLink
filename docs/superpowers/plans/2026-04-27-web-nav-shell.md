# Web Navigation Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent left sidebar with breadcrumbs to all protected web pages, with orientation-switching infrastructure roughed in for future user preference support.

**Architecture:** A `NAV_ITEMS` config array drives all nav rendering. A `NavContext` holds orientation state (defaults to `"sidebar"`). `NavShell` reads orientation and renders either `Sidebar` or `TopNav` alongside the page content. A `Breadcrumbs` component derives the current path trail from `usePathname()`. The protected layout is updated to wrap all children in `NavProvider → NavShell`.

**Tech Stack:** Next.js 15 App Router, React context, Tailwind CSS, `usePathname` (next/navigation), Vitest + Testing Library (jsdom), `@clerk/nextjs` (`useUser` for the bottom user name).

---

## File Map

| Status | Path | Purpose |
|--------|------|---------|
| Create | `apps/web/lib/nav.ts` | `NavItem` type + `NAV_ITEMS` config array |
| Create | `apps/web/contexts/NavContext.tsx` | Orientation context + `NavProvider` + `useNavOrientation` hook |
| Create | `apps/web/components/nav/Sidebar.tsx` | Left sidebar component |
| Create | `apps/web/components/nav/TopNav.tsx` | Top nav stub (orientation wiring only) |
| Create | `apps/web/components/nav/NavShell.tsx` | Renders Sidebar or TopNav + main content area |
| Create | `apps/web/components/nav/Breadcrumbs.tsx` | Path-derived breadcrumb trail |
| Modify | `apps/web/app/(protected)/layout.tsx` | Add NavProvider + NavShell |
| Create | `apps/web/src/components/nav/__tests__/Breadcrumbs.test.tsx` | Tests for breadcrumb logic |
| Create | `apps/web/src/components/nav/__tests__/Sidebar.test.tsx` | Tests for sidebar rendering + active state |

---

### Task 1: Nav config

**Files:**
- Create: `apps/web/lib/nav.ts`

- [ ] **Step 1: Write the file**

```ts
// apps/web/lib/nav.ts

export interface NavItem {
  label: string;
  href: string;
  icon: string;
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

- [ ] **Step 2: Verify TypeScript**

Run from `apps/web/`:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/nav.ts
git commit -m "feat: nav config"
```

---

### Task 2: NavContext

**Files:**
- Create: `apps/web/contexts/NavContext.tsx`

- [ ] **Step 1: Write the file**

```tsx
// apps/web/contexts/NavContext.tsx
"use client";

import { createContext, useContext, useState } from "react";

export type NavOrientation = "sidebar" | "topnav";

interface NavContextValue {
  orientation: NavOrientation;
  setOrientation: (o: NavOrientation) => void;
}

const NavContext = createContext<NavContextValue | null>(null);

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [orientation, setOrientation] = useState<NavOrientation>("sidebar");
  return (
    <NavContext.Provider value={{ orientation, setOrientation }}>
      {children}
    </NavContext.Provider>
  );
}

export function useNavOrientation(): NavContextValue {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNavOrientation must be used inside NavProvider");
  return ctx;
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/contexts/NavContext.tsx
git commit -m "feat: NavContext orientation"
```

---

### Task 3: Breadcrumbs component + tests

**Files:**
- Create: `apps/web/components/nav/Breadcrumbs.tsx`
- Create: `apps/web/src/components/nav/__tests__/Breadcrumbs.test.tsx`

Breadcrumbs are pure path-derivation logic — no API calls, no auth. Test first.

**Segment label map** — translate URL segments to human-readable labels:

```ts
const SEGMENT_LABELS: Record<string, string> = {
  dashboard:  "Dashboard",
  events:     "Events",
  family:     "Family",
  calendar:   "Calendar",
  assistant:  "AI Assistant",
  members:    "Members",
  new:        "New",
};
```

Segments not in the map render as-is (dynamic IDs like UUIDs).

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/src/components/nav/__tests__/Breadcrumbs.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Mock usePathname — controlled per test
const mockPathname = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { Breadcrumbs } from "@/components/nav/Breadcrumbs";

describe("Breadcrumbs", () => {
  it("renders nothing on /dashboard", () => {
    mockPathname.mockReturnValue("/dashboard");
    const { container } = render(<Breadcrumbs />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a single crumb for /events", () => {
    mockPathname.mockReturnValue("/events");
    render(<Breadcrumbs />);
    expect(screen.getByText("Events")).toBeInTheDocument();
    // current segment is not a link
    expect(screen.queryByRole("link", { name: "Events" })).not.toBeInTheDocument();
  });

  it("renders linked parent and current leaf for /events/abc123", () => {
    mockPathname.mockReturnValue("/events/abc123");
    render(<Breadcrumbs />);
    const link = screen.getByRole("link", { name: "Events" });
    expect(link).toHaveAttribute("href", "/events");
    expect(screen.getByText("abc123")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "abc123" })).not.toBeInTheDocument();
  });

  it("renders three crumbs for /family/fam1/members/person1", () => {
    mockPathname.mockReturnValue("/family/fam1/members/person1");
    render(<Breadcrumbs />);
    expect(screen.getByRole("link", { name: "Family" })).toHaveAttribute("href", "/family");
    expect(screen.getByRole("link", { name: "Members" })).toHaveAttribute("href", "/family/fam1/members");
    expect(screen.getByText("person1")).toBeInTheDocument();
  });

  it("uses SEGMENT_LABELS to humanise known segments", () => {
    mockPathname.mockReturnValue("/assistant");
    render(<Breadcrumbs />);
    expect(screen.getByText("AI Assistant")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `apps/web/`:
```bash
npx vitest run src/components/nav/__tests__/Breadcrumbs.test.tsx
```
Expected: FAIL — `Cannot find module '@/components/nav/Breadcrumbs'`

- [ ] **Step 3: Write the component**

```tsx
// apps/web/components/nav/Breadcrumbs.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SEGMENT_LABELS: Record<string, string> = {
  dashboard:  "Dashboard",
  events:     "Events",
  family:     "Family",
  calendar:   "Calendar",
  assistant:  "AI Assistant",
  members:    "Members",
  new:        "New",
};

function labelFor(segment: string): string {
  return SEGMENT_LABELS[segment] ?? segment;
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  // Nothing to show on the root protected page
  if (segments.length === 0 || (segments.length === 1 && segments[0] === "dashboard")) {
    return null;
  }

  const crumbs = segments.map((seg, i) => ({
    label: labelFor(seg),
    href: "/" + segments.slice(0, i + 1).join("/"),
    isLast: i === segments.length - 1,
  }));

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 px-6 pt-4 pb-2 text-xs">
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-1">
          {i > 0 && <span style={{ color: "#475569" }}>›</span>}
          {crumb.isLast ? (
            <span style={{ color: "#94a3b8" }}>{crumb.label}</span>
          ) : (
            <Link href={crumb.href} style={{ color: "#64748b" }}
              className="hover:text-slate-400 transition-colors">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/components/nav/__tests__/Breadcrumbs.test.tsx
```
Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/nav/Breadcrumbs.tsx apps/web/src/components/nav/__tests__/Breadcrumbs.test.tsx
git commit -m "feat: Breadcrumbs component"
```

---

### Task 4: Sidebar component + tests

**Files:**
- Create: `apps/web/components/nav/Sidebar.tsx`
- Create: `apps/web/src/components/nav/__tests__/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/src/components/nav/__tests__/Sidebar.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { firstName: "Steve" } }),
}));

// Mock nav config so toggle tests have a populated children array to exercise.
// The real NAV_ITEMS uses children: [] (empty slot markers) which render as plain links.
vi.mock("@/lib/nav", () => ({
  NAV_ITEMS: [
    { label: "Dashboard",    href: "/dashboard", icon: "⊞" },
    { label: "Events",       href: "/events",    icon: "📅", children: [
      { label: "All Events", href: "/events",    icon: "" },
    ]},
    { label: "Family",       href: "/family",    icon: "👨‍👩‍👧", children: [] },
    { label: "Calendar",     href: "/calendar",  icon: "🗓" },
    { label: "AI Assistant", href: "/assistant", icon: "✦" },
  ],
}));

import { Sidebar } from "@/components/nav/Sidebar";

describe("Sidebar", () => {
  it("renders the FamLink logo", () => {
    render(<Sidebar />);
    expect(screen.getByText("FamLink")).toBeInTheDocument();
  });

  it("renders all top-level nav labels", () => {
    render(<Sidebar />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Events")).toBeInTheDocument();
    expect(screen.getByText("Family")).toBeInTheDocument();
    expect(screen.getByText("Calendar")).toBeInTheDocument();
    expect(screen.getByText("AI Assistant")).toBeInTheDocument();
  });

  it("shows the signed-in user's first name", () => {
    render(<Sidebar />);
    expect(screen.getByText("Steve")).toBeInTheDocument();
  });

  it("item with populated children renders as a toggle button", () => {
    render(<Sidebar />);
    // Events has children: [...] — renders as a button
    expect(screen.getByRole("button", { name: /events/i })).toBeInTheDocument();
  });

  it("item with empty children renders as a plain link, not a button", () => {
    render(<Sidebar />);
    // Family has children: [] — renders as a link
    expect(screen.queryByRole("button", { name: /family/i })).not.toBeInTheDocument();
  });

  it("clicking the toggle expands the section", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const eventsToggle = screen.getByRole("button", { name: /events/i });
    await user.click(eventsToggle);
    expect(eventsToggle).toHaveAttribute("aria-expanded", "true");
  });

  it("clicking an expanded toggle collapses the section", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const eventsToggle = screen.getByRole("button", { name: /events/i });
    await user.click(eventsToggle); // expand
    await user.click(eventsToggle); // collapse
    expect(eventsToggle).toHaveAttribute("aria-expanded", "false");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/components/nav/__tests__/Sidebar.test.tsx
```
Expected: FAIL — `Cannot find module '@/components/nav/Sidebar'`

- [ ] **Step 3: Write the component**

```tsx
// apps/web/components/nav/Sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { NAV_ITEMS, type NavItem } from "@/lib/nav";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 10 10" fill="none"
      style={{
        transform: open ? "rotate(0deg)" : "rotate(-90deg)",
        transition: "transform 0.15s",
        color: "#64748b",
      }}
    >
      <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NavItemRow({ item, depth = 0 }: { item: NavItem; depth?: number }) {
  const pathname = usePathname();
  const hasChildren = Array.isArray(item.children) && item.children.length > 0;
  const isActive = pathname === item.href || (hasChildren && pathname.startsWith(item.href + "/"));
  const [open, setOpen] = useState(isActive);

  const paddingLeft = depth === 0 ? "16px" : "40px";
  const textColor = isActive ? "#e2e8f0" : "#94a3b8";
  const bg = isActive && !hasChildren ? "#1e293b" : "transparent";

  if (hasChildren) {
    return (
      <div>
        <button
          aria-expanded={open}
          aria-label={item.label}
          onClick={() => setOpen((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            padding: `8px 16px 8px ${paddingLeft}`,
            background: isActive ? "#1e293b" : "transparent",
            border: "none",
            cursor: "pointer",
            color: textColor,
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "15px" }}>{item.icon}</span>
            <span style={{ fontSize: "13px" }}>{item.label}</span>
          </span>
          <ChevronIcon open={open} />
        </button>
        {open && (
          <div>
            {item.children!.map((child) => (
              <NavItemRow key={child.href} item={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: `8px 16px 8px ${paddingLeft}`,
        background: bg,
        color: depth > 0 ? "#64748b" : textColor,
        textDecoration: "none",
        fontSize: "13px",
      }}
    >
      {depth === 0 && <span style={{ fontSize: "15px" }}>{item.icon}</span>}
      {depth > 0 && <span style={{ fontSize: "11px", color: "#475569" }}>·</span>}
      {item.label}
    </Link>
  );
}

export function Sidebar() {
  const { user } = useUser();

  return (
    <aside
      style={{
        width: "200px",
        minHeight: "100vh",
        background: "#0f172a",
        borderRight: "1px solid #1e293b",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div style={{
        padding: "16px",
        borderBottom: "1px solid #1e293b",
        color: "#6366f1",
        fontWeight: 700,
        fontSize: "15px",
        letterSpacing: "0.02em",
      }}>
        FamLink
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, padding: "8px 0", overflowY: "auto" }}>
        {NAV_ITEMS.map((item) => (
          <NavItemRow key={item.href} item={item} />
        ))}
      </nav>

      {/* User area */}
      <div style={{
        padding: "12px 16px",
        borderTop: "1px solid #1e293b",
        color: "#475569",
        fontSize: "12px",
      }}>
        {user?.firstName ?? ""}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/components/nav/__tests__/Sidebar.test.tsx
```
Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/nav/Sidebar.tsx apps/web/src/components/nav/__tests__/Sidebar.test.tsx
git commit -m "feat: Sidebar component"
```

---

### Task 5: TopNav stub

**Files:**
- Create: `apps/web/components/nav/TopNav.tsx`

No tests needed — this is a stub with no logic.

- [ ] **Step 1: Write the file**

```tsx
// apps/web/components/nav/TopNav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV_ITEMS, type NavItem } from "@/lib/nav";

function DropdownItem({ item }: { item: NavItem }) {
  const [open, setOpen] = useState(false);
  const hasChildren = Array.isArray(item.children) && item.children.length > 0;

  if (!hasChildren) {
    return (
      <Link
        href={item.href}
        style={{ padding: "8px 12px", color: "#94a3b8", textDecoration: "none", fontSize: "13px" }}
      >
        {item.label}
      </Link>
    );
  }

  return (
    <div style={{ position: "relative" }} onMouseLeave={() => setOpen(false)}>
      <button
        onMouseEnter={() => setOpen(true)}
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: "8px 12px",
          color: "#94a3b8",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: "13px",
        }}
      >
        {item.label}
      </button>
      {open && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          background: "#0f172a",
          border: "1px solid #1e293b",
          borderRadius: "6px",
          minWidth: "140px",
          zIndex: 50,
        }}>
          {item.children!.map((child) => (
            <Link
              key={child.href}
              href={child.href}
              style={{
                display: "block",
                padding: "8px 12px",
                color: "#94a3b8",
                textDecoration: "none",
                fontSize: "13px",
              }}
            >
              {child.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopNav() {
  return (
    <header style={{
      background: "#0f172a",
      borderBottom: "1px solid #1e293b",
      display: "flex",
      alignItems: "center",
      gap: "4px",
      padding: "0 16px",
      height: "48px",
      flexShrink: 0,
    }}>
      <span style={{ color: "#6366f1", fontWeight: 700, fontSize: "15px", marginRight: "16px" }}>
        FamLink
      </span>
      {NAV_ITEMS.map((item) => (
        <DropdownItem key={item.href} item={item} />
      ))}
    </header>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/nav/TopNav.tsx
git commit -m "feat: TopNav stub"
```

---

### Task 6: NavShell

**Files:**
- Create: `apps/web/components/nav/NavShell.tsx`

- [ ] **Step 1: Write the file**

```tsx
// apps/web/components/nav/NavShell.tsx
"use client";

import { useNavOrientation } from "@/contexts/NavContext";
import { Sidebar } from "@/components/nav/Sidebar";
import { TopNav } from "@/components/nav/TopNav";
import { Breadcrumbs } from "@/components/nav/Breadcrumbs";

export function NavShell({ children }: { children: React.ReactNode }) {
  const { orientation } = useNavOrientation();

  if (orientation === "topnav") {
    return (
      <div className="flex flex-col min-h-screen">
        <TopNav />
        <main className="flex-1 overflow-y-auto">
          <Breadcrumbs />
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Breadcrumbs />
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/nav/NavShell.tsx
git commit -m "feat: NavShell"
```

---

### Task 7: Wire into protected layout + full test run

**Files:**
- Modify: `apps/web/app/(protected)/layout.tsx`

- [ ] **Step 1: Replace the layout file**

```tsx
// apps/web/app/(protected)/layout.tsx
import { QueryProvider } from "@/components/QueryProvider";
import { NavProvider } from "@/contexts/NavContext";
import { NavShell } from "@/components/nav/NavShell";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <NavProvider>
        <NavShell>{children}</NavShell>
      </NavProvider>
    </QueryProvider>
  );
}
```

- [ ] **Step 2: Run the full web test suite**

```bash
npx vitest run
```
Expected: all tests pass (including existing EventCard, PersonHeader, calendar, assistant tests).

- [ ] **Step 3: Start the dev server and verify visually**

```bash
# from repo root
npm run dev --workspace=apps/web
```

Open `http://localhost:3000/dashboard`. Verify:
- Sidebar appears on the left
- All 5 nav items visible
- Events and Family items have chevrons (but open to nothing since `children: []`)
- Clicking a nav item navigates correctly
- Breadcrumbs appear above page content on any non-dashboard route (e.g. `/events`)
- User first name appears at the bottom of the sidebar

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/(protected)/layout.tsx
git commit -m "feat: P2-11 web nav shell — sidebar + breadcrumbs"
```
