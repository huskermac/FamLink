# P2-09 Mobile Core Screens — Design Spec

*April 2026 | FamLink Phase 2*

---

## Overview

Build the React Native mobile app for FamLink Phase 2. The app targets wedge features — event coordination and shared calendar — with feature parity on participant flows. Organizer flows (event creation, invitation management) remain web-only for Phase 2 and are additive in Phase 3 with no rework required.

**Build order prerequisite:** All API routes complete (P2-00 through P2-08).

---

## Decisions Summary

| Area | Decision |
|---|---|
| Navigation | Fixed 4-tab bar — Family, Events, Calendar, Assistant |
| Auth | Clerk Expo SDK (`@clerk/clerk-expo`) + `expo-secure-store` |
| Real-time | TanStack Query polling, `REFRESH_INTERVAL_MS = 10_000` (configurable constant) |
| API client | `useApiFetch()` hook in `apps/mobile/lib/api.ts` |
| Env config | `EXPO_PUBLIC_API_URL` |
| Events scope | View + RSVP + claim EventItems (no create/manage — web-only for Phase 2) |
| Family scope | Read-only member directory + person profiles |
| Assistant | Streaming chat + inline tool result cards |
| Testing | Jest + jest-expo preset, unit tests for hooks and lib utilities only |

---

## Architecture

### Data Flow

```
Clerk Expo SDK
    └── getToken() → Bearer JWT
              ↓
       useApiFetch() hook
              ↓
    TanStack Query hooks
    (useFamily, useEvents, useCalendar)
              ↓
      Screen components
```

Assistant chat uses a streaming fetch directly (not TanStack Query) — same pattern as the web AI chat.

### Tech Stack Additions

| Package | Purpose |
|---|---|
| `@clerk/clerk-expo` | Auth — native Clerk SDK for Expo |
| `expo-secure-store` | Token cache for Clerk JWT persistence |
| `@tanstack/react-query` | Data fetching, caching, polling |
| `@tanstack/react-query-devtools` | Dev-only |

---

## File Structure

```
apps/mobile/
├── app/
│   ├── _layout.tsx              # Root — ClerkProvider + QueryClientProvider
│   ├── index.tsx                # Redirect: isSignedIn → (tabs), else → (auth)/sign-in
│   ├── (auth)/
│   │   ├── _layout.tsx          # Stack navigator
│   │   ├── sign-in.tsx          # Email + password sign-in
│   │   └── sign-up.tsx          # Email + password + name sign-up
│   └── (tabs)/
│       ├── _layout.tsx          # Bottom tab navigator — 4 tabs
│       ├── family/
│       │   ├── _layout.tsx      # Stack navigator
│       │   ├── index.tsx        # Member directory list
│       │   └── [personId].tsx   # Person profile (read-only)
│       ├── events/
│       │   ├── _layout.tsx      # Stack navigator
│       │   ├── index.tsx        # Upcoming events list
│       │   └── [eventId].tsx    # Event detail + RSVP + EventItems
│       ├── calendar/
│       │   ├── _layout.tsx      # Stack navigator
│       │   ├── index.tsx        # Monthly calendar grid
│       │   └── [date].tsx       # Day view — events and birthdays
│       └── assistant/
│           ├── _layout.tsx      # Stack navigator
│           └── index.tsx        # AI chat interface
├── hooks/
│   ├── useFamily.ts             # useMembers(), usePerson(id)
│   ├── useEvents.ts             # useEvents(), useEvent(id), useRsvp(eventId)
│   └── useCalendar.ts           # useCalendarMonth(year, month), useCalendarDay(date)
├── lib/
│   ├── api.ts                   # useApiFetch() — pre-authed fetch hook
│   └── config.ts                # REFRESH_INTERVAL_MS and other constants
└── providers/
    └── QueryProvider.tsx        # QueryClient with global refetchInterval
```

---

## Auth Flow

- `ClerkProvider` at root receives `publishableKey` from `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (via `app.config.js` → `Constants.expoConfig.extra`).
- `tokenCache` set to `createTokenCache(SecureStore)` — JWTs persist across app restarts.
- Same Clerk instance as the web app — same users, no new server-side config.
- Sign-in/sign-up: email + password only. No OAuth for Phase 2.
- Route protection: `(tabs)/_layout.tsx` checks `isSignedIn` from `useAuth()`, redirects to `(auth)/sign-in` if false.
- `useApiFetch()` calls `getToken()` from `useAuth()` and injects `Authorization: Bearer <token>` on every request — identical behaviour to the web `apiFetch`.

---

## Data Layer

### QueryClient Config

```ts
// providers/QueryProvider.tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: REFRESH_INTERVAL_MS,  // 10_000 by default
      staleTime: 5_000,
    },
  },
});
```

Screens that don't need polling (e.g. static person profile) pass `refetchInterval: false` to their query hook.

### API Client

```ts
// lib/api.ts
export function useApiFetch() {
  const { getToken } = useAuth();
  return async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getToken();
    const base = process.env.EXPO_PUBLIC_API_URL;
    const url = `${base}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  };
}
```

### Hook Pattern

```ts
// hooks/useEvents.ts
export function useEvents() {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["events"],
    queryFn: () => apiFetch<Event[]>("/events"),
  });
}
```

All shared types come from `packages/shared/src/types`.

---

## Screen Inventory

### Family Tab

**`family/index.tsx` — Member Directory**
- List of family members within scope (INTERNAL + BOUNDARY)
- Per-card: name, photo placeholder, household name
- Tap → person profile
- Polling enabled

> **Open question (resolve before building):** What secondary label, if any, should appear on each member card? "Relationship" is ambiguous — each person has multiple relationships. Options: household name, scope badge (Internal/Boundary), role, or no label. Needs a decision before implementation.

**`family/[personId].tsx` — Person Profile**
- Name, photo, birthdate, household
- Relationships list (all relationships for this person, each with the counterpart name and relationship type)
- Read-only for Phase 2
- `refetchInterval: false` (static data)

### Events Tab

**`events/index.tsx` — Events List**
- Upcoming events sorted by date
- Per-card: name, date, location, user's RSVP status badge
- Polling enabled

**`events/[eventId].tsx` — Event Detail**
- Full event details (name, date, time, location, description)
- RSVP buttons: Yes / No / Maybe — calls `PATCH /events/:id/rsvp`
- EventItems list: item name, quantity, status, claimed-by name
- Claim button on `UNCLAIMED` items — calls `PATCH /event-items/:id/claim`
- Organizer actions (edit, invite, manage items) are intentionally absent — web-only for Phase 2

### Calendar Tab

**`calendar/index.tsx` — Monthly Grid**
- Full month grid
- Days with events show a dot indicator
- Birthdays shown with a distinct indicator (different color or icon)
- Tap a day → day view
- Month navigation (prev/next)

**`calendar/[date].tsx` — Day View**
- Events and birthdays on that date
- Tap an event → navigates to `events/[eventId]`

### Assistant Tab

**`assistant/index.tsx` — AI Chat**
- Full-screen chat interface
- Message history (user + assistant turns)
- Streaming response display
- Input bar pinned above keyboard (KeyboardAvoidingView)
- Tool result cards rendered inline — simplified mobile layout vs. web cards
- Propose-confirm flow unchanged — driven by API responses, no mobile-specific changes needed

### Auth Screens

**`(auth)/sign-in.tsx`** — Email + password, link to sign-up
**`(auth)/sign-up.tsx`** — Email + password + name, link to sign-in

---

## Real-Time Strategy

No Socket.io connection on mobile for Phase 2. All screens use TanStack Query's `refetchInterval` for automatic background polling.

- Default interval: `10_000ms` (10 seconds), defined in `lib/config.ts`
- User-configurable interval: Phase 3
- Push notifications: Phase 3

---

## Testing

- Framework: Jest + `jest-expo` preset (already configured)
- Test location: `apps/mobile/__tests__/`
- In scope: unit tests for hooks (mock `useApiFetch`), unit tests for `lib/api.ts` and `lib/config.ts`
- Out of scope: UI snapshot tests, E2E (Detox/Maestro) — Phase 3

---

## Phase 3 Upgrade Path

Nothing in this design constrains Phase 3. All additions are purely additive:
- Event creation and organizer screens → new routes under `events/`
- Socket.io real-time → replace/augment `refetchInterval` in `QueryProvider`
- Push notifications → add Expo Notifications alongside or instead of polling
- Navigation favorites/hybrid → wrap tab bar with user preferences layer
- User-configurable refresh interval → expose `REFRESH_INTERVAL_MS` in Settings screen

---

## Open Questions

| # | Question | Owner | Needed before |
|---|---|---|---|
| OQ-1 | Family tab card — what secondary label per person (household, scope, role, or none)? | Steve | Family screens build |
