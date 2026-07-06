# W3a-UI-mobile PR 2 (Organizer Slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the mobile app the organizer side of cross-family participation — an invite screen (family members + cross-family suggestions with an admin-gated role toggle + external guest) and participant management (list + admin revoke/role) on the own-event detail.

**Architecture:** All API endpoints already exist (shipped in W3a-API); this is mobile-only. Mobile client hooks in `useEvents.ts` mirror the shipped web client (`apps/web/lib/api/events.ts`) and the API contracts 1:1. A new invite screen lives at a **sibling** route `events/invite/[eventId].tsx` (avoids restructuring the merged `[eventId].tsx` detail route). `OwnEventDetail` gains an "Invite" button (navigates to it) and a Participants section. Client admin-gating uses **family roles only** (`useMyFamilies`), matching what web ships; the server stays authoritative. Spec §5: `docs/superpowers/specs/2026-07-06-w3a-ui-mobile-design.md`. Builds on merged PR 1 (`d1abca7`).

**Tech Stack:** React Native 0.74 / Expo 51 / expo-router 3.5 / NativeWind 4 / @tanstack/react-query 5 / jest-expo + @testing-library/react-native.

## Global Constraints

- **Admin-gating rule (spec §5.1/§5.2, council round-2):** client `canAdmin` is derived from **family membership roles only** — `useMyFamilies` → the membership for the event's `familyGroupId` → `roles.some(r => r === "ADMIN" || r === "ORGANIZER")` (identical to web `invite/page.tsx:34`). Do NOT use the server's broader creator/event-admin predicate for client gating. Client gating is cosmetic; the server (`resolveEventAccess.canAdmin`) is authoritative and 403s anything else.
- **The role toggle** ("Make event admin") on a suggestion is rendered ONLY when the viewer `canAdmin` AND that suggestion is selected. Non-admins still see/select suggestions but they send as plain `PARTICIPANT` (the API 403s a non-admin `famlinkUser` invite, so the control is hidden, not disabled).
- **Guest copy is neutral:** the invite screen reports **"Invitations created"** (or "Sending…"/"Send invitations" on the button) — never asserts delivery success (guest email is sandbox-blocked in prod).
- **Participants endpoint is owning-members-ONLY:** `GET /:eventId/participants` 403s every cross-family participant (even EVENT_ADMIN). The Participants section therefore lives only in `OwnEventDetail`. REVOKED rows shown muted (history). Revoke/role actions are admin-gated per the rule above.
- **Isolation:** nothing here renders another family's identifiers; suggestions/participants show display names only. The invite screen is reachable only from `OwnEventDetail` (own events).
- **Verification per task (MANDATORY before every commit):** `npm run type-check --workspace=famlink-mobile` (clean) AND `npm run lint --workspace=famlink-mobile` (0 errors; pre-existing warnings OK — lint now covers `components/`) AND the task's jest tests. An eslint-only error broke CI once (PR #6) — never commit on tests alone.
- **GitNexus (repo rule):** before a task EDITS an existing symbol, run `mcp__gitnexus__impact({target: "<symbol>", direction: "upstream"})` and note the blast radius — specifically `OwnEventDetail` (edited in Tasks 2 and 3); surface HIGH/CRITICAL to the controller before proceeding. Adding new hooks/a new screen file creates symbols rather than editing them, so impact there is optional. Run `mcp__gitnexus__detect_changes` before each commit and confirm scope is confined to mobile files. (If the index still carries the phantom `p3-03-w3a-ui-web` primary-slot label, pass `--branch main`.)
- Commit format `feat: P3-03 <description>`. Windows dev machine — use `npm.cmd` if `npm` fails. Do NOT modify the API or `apps/web/**`. Mobile already runs in CI (added in PR 1) — no CI change needed.

**Reference — API contracts (already shipped, do not change):**
- `POST /api/v1/events/:eventId/invitations` body `{ invitees: InviteeEntry[] }`, discriminated union `person | famlinkUser(+role) | guest`.
- `GET /api/v1/events/:eventId/invitee-suggestions` → `{ suggestions: InviteeSuggestion[] }`.
- `GET /api/v1/events/:eventId/participants` (owning-member only) → `{ participants: ParticipantRecord[] }`.
- `POST /api/v1/events/:eventId/participants/:personId/revoke` → `{ revoked: true }` (canAdmin).
- `PUT /api/v1/events/:eventId/participants/:personId/role` body `{ role }` → `{ updated: true }` (canAdmin).

---

### Task 1: Mobile client — organizer hooks + types + `useIsFamilyAdmin`

**Files:**
- Modify: `apps/mobile/hooks/useEvents.ts`
- Modify: `apps/mobile/hooks/useFamily.ts` (add `useIsFamilyAdmin`)
- Test: `apps/mobile/__tests__/hooks/useEvents.test.ts`, `apps/mobile/__tests__/hooks/useFamily.test.ts`

**Interfaces:**
- Consumes: `useApiFetch` (`../lib/api`), `useMyFamilies` (`./useFamily`).
- Produces (Tasks 2–3 depend on these exact names/types):
  - `type InviteeEntry = { kind: "person"; personId: string } | { kind: "famlinkUser"; personId: string; role?: "PARTICIPANT" | "EVENT_ADMIN" } | { kind: "guest"; guestEmail?: string; guestPhone?: string; guestName?: string }`
  - `interface InviteeSuggestion { person: { id: string; displayName: string; avatarUrl: string | null }; via: { personId: string; personName: string; relationshipType: string; relationshipState: string }; sharedChildren: { id: string; displayName: string }[] }`
  - `interface ParticipantRecord { personId: string; displayName: string; role: "PARTICIPANT" | "EVENT_ADMIN"; status: "ACTIVE" | "REVOKED" }`
  - `useInviteeSuggestions(eventId: string)` → query key `["invitee-suggestions", eventId]`, GET `/api/v1/events/${eventId}/invitee-suggestions`, returns `{ suggestions: InviteeSuggestion[] }`
  - `useSendInvitations(eventId: string)` → `mutate(invitees: InviteeEntry[])` → POST `/api/v1/events/${eventId}/invitations` body `{ invitees }`; invalidates `["event", eventId]`
  - `useParticipants(eventId: string)` → query key `["participants", eventId]`, GET `/api/v1/events/${eventId}/participants`, returns `{ participants: ParticipantRecord[] }`
  - `useRevokeParticipant(eventId: string)` → `mutate(personId: string)` → POST `/api/v1/events/${eventId}/participants/${personId}/revoke`; invalidates `["participants", eventId]`
  - `useSetParticipantRole(eventId: string)` → `mutate({ personId, role }: { personId: string; role: "PARTICIPANT" | "EVENT_ADMIN" })` → PUT `/api/v1/events/${eventId}/participants/${personId}/role` body `{ role }`; invalidates `["participants", eventId]`
  - `useIsFamilyAdmin(familyGroupId: string | null): boolean` (in `useFamily.ts`) — true when the requester's membership for `familyGroupId` has role ADMIN or ORGANIZER.

- [ ] **Step 1: Write failing hook tests** — append to `apps/mobile/__tests__/hooks/useEvents.test.ts` (merge new names into the existing import line: `useInviteeSuggestions, useSendInvitations, useParticipants, useRevokeParticipant, useSetParticipantRole`):

```ts
describe("organizer hooks", () => {
  it("useInviteeSuggestions GETs the suggestions endpoint", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ suggestions: [] });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useInviteeSuggestions("e1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/events/e1/invitee-suggestions");
  });

  it("useSendInvitations POSTs the tagged invitees array", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ invitations: [] });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useSendInvitations("e1"), { wrapper });
    const invitees = [{ kind: "person", personId: "p1" }, { kind: "famlinkUser", personId: "p2", role: "EVENT_ADMIN" }];
    await act(async () => { result.current.mutate(invitees as never); });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/invitations",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ invitees }) })
    );
  });

  it("useParticipants GETs the participants endpoint", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ participants: [] });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useParticipants("e1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/events/e1/participants");
  });

  it("useRevokeParticipant POSTs the revoke endpoint", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ revoked: true });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useRevokeParticipant("e1"), { wrapper });
    await act(async () => { result.current.mutate("p9"); });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/participants/p9/revoke",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("useSetParticipantRole PUTs the role endpoint with the role body", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ updated: true });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useSetParticipantRole("e1"), { wrapper });
    await act(async () => { result.current.mutate({ personId: "p9", role: "EVENT_ADMIN" }); });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/participants/p9/role",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ role: "EVENT_ADMIN" }) })
    );
  });
});
```

Create `apps/mobile/__tests__/hooks/useFamily.test.ts` additions (or a new describe if the file exists — check first; the file already exists per `apps/mobile/__tests__/hooks/useFamily.test.ts`). Append:

```ts
import { useIsFamilyAdmin } from "../../hooks/useFamily";

describe("useIsFamilyAdmin", () => {
  function mockFamilies(memberships: Array<{ id: string; roles: string[] }>) {
    const mockFetch = jest.fn().mockResolvedValue({
      memberships: memberships.map((m) => ({ familyGroup: { id: m.id, name: "F" }, roles: m.roles, joinedAt: "" })),
    });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
  }
  it("true when the membership for the family has ADMIN or ORGANIZER", async () => {
    mockFamilies([{ id: "famA", roles: ["ADMIN"] }]);
    const { result } = renderHook(() => useIsFamilyAdmin("famA"), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));
  });
  it("false for a non-admin membership, and false for null family", async () => {
    mockFamilies([{ id: "famA", roles: ["MEMBER"] }]);
    const { result: r1 } = renderHook(() => useIsFamilyAdmin("famA"), { wrapper });
    await waitFor(() => expect(r1.current).toBe(false));
    const { result: r2 } = renderHook(() => useIsFamilyAdmin(null), { wrapper });
    expect(r2.current).toBe(false);
  });
});
```

(If `useFamily.test.ts` lacks the `useApiFetch` mock + `wrapper` scaffolding, copy them from `useEvents.test.ts`'s top-of-file setup.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=famlink-mobile -- __tests__/hooks/useEvents.test.ts __tests__/hooks/useFamily.test.ts`
Expected: FAIL — the new exports don't exist.

- [ ] **Step 3: Implement the hooks + types** — in `apps/mobile/hooks/useEvents.ts`, add:

```ts
export type InviteeEntry =
  | { kind: "person"; personId: string }
  | { kind: "famlinkUser"; personId: string; role?: "PARTICIPANT" | "EVENT_ADMIN" }
  | { kind: "guest"; guestEmail?: string; guestPhone?: string; guestName?: string };

export interface InviteeSuggestion {
  person: { id: string; displayName: string; avatarUrl: string | null };
  via: { personId: string; personName: string; relationshipType: string; relationshipState: string };
  sharedChildren: { id: string; displayName: string }[];
}

export interface ParticipantRecord {
  personId: string;
  displayName: string;
  role: "PARTICIPANT" | "EVENT_ADMIN";
  status: "ACTIVE" | "REVOKED";
}

export function useInviteeSuggestions(eventId: string, opts?: { enabled?: boolean }) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["invitee-suggestions", eventId],
    queryFn: () => apiFetch<{ suggestions: InviteeSuggestion[] }>(`/api/v1/events/${eventId}/invitee-suggestions`),
    enabled: opts?.enabled ?? true,
  });
}

export function useSendInvitations(eventId: string) {
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invitees: InviteeEntry[]) =>
      apiFetch(`/api/v1/events/${eventId}/invitations`, { method: "POST", body: JSON.stringify({ invitees }) }),
    onSuccess: () => {
      // Invited people drop off the suggestion list and (for members) may appear
      // as participants — refresh both alongside the event.
      void queryClient.invalidateQueries({ queryKey: ["event", eventId] });
      void queryClient.invalidateQueries({ queryKey: ["invitee-suggestions", eventId] });
      void queryClient.invalidateQueries({ queryKey: ["participants", eventId] });
    },
  });
}

export function useParticipants(eventId: string) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["participants", eventId],
    queryFn: () => apiFetch<{ participants: ParticipantRecord[] }>(`/api/v1/events/${eventId}/participants`),
  });
}

export function useRevokeParticipant(eventId: string) {
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (personId: string) =>
      apiFetch(`/api/v1/events/${eventId}/participants/${personId}/revoke`, { method: "POST" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["participants", eventId] }); },
  });
}

export function useSetParticipantRole(eventId: string) {
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ personId, role }: { personId: string; role: "PARTICIPANT" | "EVENT_ADMIN" }) =>
      apiFetch(`/api/v1/events/${eventId}/participants/${personId}/role`, { method: "PUT", body: JSON.stringify({ role }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["participants", eventId] }); },
  });
}
```

In `apps/mobile/hooks/useFamily.ts`, add (after `useMyFamilies`):

```ts
export function useIsFamilyAdmin(familyGroupId: string | null): boolean {
  const families = useMyFamilies();
  if (!familyGroupId) return false;
  const membership = families.data?.memberships.find((m) => m.familyGroup.id === familyGroupId);
  return (membership?.roles ?? []).some((r) => r === "ADMIN" || r === "ORGANIZER");
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test --workspace=famlink-mobile -- __tests__/hooks/useEvents.test.ts __tests__/hooks/useFamily.test.ts` → PASS.
Run: `npm run type-check --workspace=famlink-mobile` and `npm run lint --workspace=famlink-mobile` → clean / 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/hooks/useEvents.ts apps/mobile/hooks/useFamily.ts apps/mobile/__tests__/hooks/useEvents.test.ts apps/mobile/__tests__/hooks/useFamily.test.ts
git commit -m "feat: P3-03 mobile organizer hooks (invite/suggestions/participants) + useIsFamilyAdmin"
```

---

### Task 2: Invite screen + "Invite" button on `OwnEventDetail`

**Files:**
- Create: `apps/mobile/app/(tabs)/events/invite/[eventId].tsx`
- Modify: `apps/mobile/app/(tabs)/events/_layout.tsx` (register the invite screen)
- Modify: `apps/mobile/components/events/OwnEventDetail.tsx` (add the Invite button + `useRouter`)
- Test: `apps/mobile/__tests__/screens/invite.test.tsx` (new); `apps/mobile/__tests__/components/OwnEventDetail.test.tsx` (add `expo-router` mock)

**Interfaces:**
- Consumes: Task 1's `useInviteeSuggestions`, `useSendInvitations`, `InviteeEntry`, `InviteeSuggestion`; `useMembers` (`useFamily.ts`, returns `{ members: { person: { id, firstName, lastName, preferredName }, roles }[] }`), `useEvent`, `isForeignEvent`, `useIsFamilyAdmin`.
- Produces: a route at `/(tabs)/events/invite/${eventId}`. Nothing downstream consumes it.

Route note: `events/_layout.tsx` hardcodes its `Stack.Screen` entries (`index`, `[eventId]`). Add a screen for the sibling route so it gets a proper header title:
```tsx
      <Stack.Screen name="invite/[eventId]" options={{ title: "Invite" }} />
```
(Insert it inside the `<Stack>` after the `[eventId]` line in `apps/mobile/app/(tabs)/events/_layout.tsx`.)

- [ ] **Step 1: Write the failing screen test** — create `apps/mobile/__tests__/screens/invite.test.tsx`:

```tsx
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import InviteScreen from "../../app/(tabs)/events/invite/[eventId]";

const mockSend = jest.fn();
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ eventId: "e1" }), useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock("../../hooks/useEvents", () => ({
  ...jest.requireActual("../../hooks/useEvents"),
  useEvent: jest.fn(() => ({ data: { event: { id: "e1", familyGroupId: "famA", createdByPersonId: "p0" }, invitations: 0, rsvps: {}, eventItems: [] }, isLoading: false })),
  useInviteeSuggestions: jest.fn(() => ({ data: { suggestions: [{ person: { id: "s1", displayName: "Dana Cross", avatarUrl: null }, via: { personId: "k1", personName: "Kid One", relationshipType: "PARENT", relationshipState: "CONFIRMED" }, sharedChildren: [] }] }, isLoading: false })),
  useSendInvitations: jest.fn(() => ({ mutate: mockSend, isPending: false })),
}));
jest.mock("../../hooks/useFamily", () => ({
  useMembers: jest.fn(() => ({ data: { members: [{ person: { id: "m1", firstName: "Mom", lastName: "Smith", preferredName: null }, roles: [] }] }, isLoading: false })),
  useIsFamilyAdmin: jest.fn(() => true),
}));

describe("InviteScreen", () => {
  beforeEach(() => mockSend.mockClear());

  it("renders member, suggestion, and external guest sections", () => {
    render(<InviteScreen />);
    expect(screen.getByText("Mom Smith")).toBeTruthy();
    expect(screen.getByText("Dana Cross")).toBeTruthy();
    expect(screen.getByPlaceholderText("Name")).toBeTruthy();
    expect(screen.getByPlaceholderText("Email address")).toBeTruthy();
  });

  it("sends a tagged invitees array: selected member + suggestion(+admin role) + external guest", () => {
    render(<InviteScreen />);
    fireEvent.press(screen.getByText("Mom Smith"));           // select member
    fireEvent.press(screen.getByText("Dana Cross"));          // select suggestion
    fireEvent.press(screen.getByText("Make event admin"));    // admin toggle (visible: admin + selected)
    fireEvent.changeText(screen.getByPlaceholderText("Name"), "Guest Gary");
    fireEvent.changeText(screen.getByPlaceholderText("Email address"), "gary@example.com");
    fireEvent.press(screen.getByText("Send invitations"));
    // mutate is called as mutate(invitees, { onSuccess }) — assert the array arg,
    // tolerate the options object as the 2nd arg.
    expect(mockSend).toHaveBeenCalledWith(
      [
        { kind: "person", personId: "m1" },
        { kind: "famlinkUser", personId: "s1", role: "EVENT_ADMIN" },
        { kind: "guest", guestName: "Guest Gary", guestEmail: "gary@example.com", guestPhone: undefined },
      ],
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it("shows the admin toggle only after a suggestion is selected", () => {
    render(<InviteScreen />);
    expect(screen.queryByText("Make event admin")).toBeNull(); // hidden before selection
    fireEvent.press(screen.getByText("Dana Cross"));
    expect(screen.getByText("Make event admin")).toBeTruthy(); // shown after selection (admin viewer)
  });

  it("hides the admin toggle for a non-admin viewer", () => {
    const { useIsFamilyAdmin } = require("../../hooks/useFamily");
    (useIsFamilyAdmin as jest.Mock).mockReturnValueOnce(false);
    render(<InviteScreen />);
    fireEvent.press(screen.getByText("Dana Cross"));
    expect(screen.queryByText("Make event admin")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test --workspace=famlink-mobile -- __tests__/screens/invite.test.tsx`
Expected: FAIL — screen doesn't exist.

- [ ] **Step 3: Implement the invite screen** — create `apps/mobile/app/(tabs)/events/invite/[eventId].tsx`:

```tsx
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator } from "react-native";
import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEvent, isForeignEvent, useInviteeSuggestions, useSendInvitations } from "../../../../hooks/useEvents";
import type { InviteeEntry } from "../../../../hooks/useEvents";
import { useMembers, useIsFamilyAdmin } from "../../../../hooks/useFamily";
import type { ReactElement } from "react";

export default function InviteScreen(): ReactElement {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const router = useRouter();
  const eventQuery = useEvent(eventId);
  const detail = eventQuery.data;
  const familyGroupId = detail && !isForeignEvent(detail) ? detail.event.familyGroupId : null;

  const membersQuery = useMembers(familyGroupId);
  // Only fetch suggestions for a manageable own-family event — a foreign/missing
  // event (familyGroupId null) must not fire the request (council round-2).
  const suggestionsQuery = useInviteeSuggestions(eventId, { enabled: !!familyGroupId });
  const canAdmin = useIsFamilyAdmin(familyGroupId);
  const sendMutation = useSendInvitations(eventId);

  const [selectedPersonIds, setSelectedPersonIds] = useState<Set<string>>(new Set());
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<string>>(new Set());
  const [adminSuggestionIds, setAdminSuggestionIds] = useState<Set<string>>(new Set());
  const [externalName, setExternalName] = useState("");
  const [externalEmail, setExternalEmail] = useState("");
  const [externalPhone, setExternalPhone] = useState("");

  function toggle(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }

  function handleSend() {
    if (sendMutation.isPending) return;
    const invitees: InviteeEntry[] = [
      ...[...selectedPersonIds].map((id): InviteeEntry => ({ kind: "person", personId: id })),
      ...[...selectedSuggestionIds].map((id): InviteeEntry => ({ kind: "famlinkUser", personId: id, role: adminSuggestionIds.has(id) ? "EVENT_ADMIN" : "PARTICIPANT" })),
      ...(externalEmail || externalPhone
        ? [{ kind: "guest", guestName: externalName || "Guest", guestEmail: externalEmail || undefined, guestPhone: externalPhone || undefined } as InviteeEntry]
        : []),
    ];
    if (invitees.length === 0) return;
    sendMutation.mutate(invitees, { onSuccess: () => router.back() });
  }

  if (eventQuery.isLoading) {
    return <View className="flex-1 bg-slate-950 items-center justify-center"><ActivityIndicator color="#6366f1" /></View>;
  }
  // Guard: inviting is only for an own-family event. A foreign/missing event yields
  // familyGroupId === null — never render the invite form for it (the server would 403
  // a famlinkUser invite anyway, but don't present the UI in the first place).
  if (!familyGroupId) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center px-6">
        <Text className="text-slate-400 text-center">This event can’t be managed here.</Text>
      </View>
    );
  }

  const members = membersQuery.data?.members ?? [];
  const suggestions = suggestionsQuery.data?.suggestions ?? [];

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 24 }}>
      <Text className="text-slate-50 text-xl font-bold mb-1">Invite people</Text>
      <Text className="text-slate-400 text-sm mb-6">Select family members, suggested guests, or add someone external.</Text>

      {members.length > 0 && (
        <View className="mb-6">
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">Family members</Text>
          {members.map((m) => {
            const name = m.person.preferredName ?? `${m.person.firstName} ${m.person.lastName}`.trim();
            const selected = selectedPersonIds.has(m.person.id);
            return (
              <TouchableOpacity
                key={m.person.id}
                onPress={() => setSelectedPersonIds((s) => toggle(s, m.person.id))}
                className="flex-row items-center bg-slate-800 rounded-xl px-4 py-3 mb-2"
              >
                <View style={{ width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: selected ? "#6366f1" : "#475569", backgroundColor: selected ? "#6366f1" : "transparent", marginRight: 10 }} />
                <Text className="text-slate-50">{name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {suggestions.length > 0 && (
        <View className="mb-6">
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">Suggested guests</Text>
          {suggestions.map((s) => {
            const selected = selectedSuggestionIds.has(s.person.id);
            return (
              <View key={s.person.id} className="bg-slate-800 rounded-xl px-4 py-3 mb-2">
                <TouchableOpacity className="flex-row items-center" onPress={() => setSelectedSuggestionIds((set) => toggle(set, s.person.id))}>
                  <View style={{ width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: selected ? "#6366f1" : "#475569", backgroundColor: selected ? "#6366f1" : "transparent", marginRight: 10 }} />
                  <View className="flex-1">
                    <Text className="text-slate-50">{s.person.displayName}</Text>
                    <Text className="text-slate-500 text-xs">via {s.via.personName} · {s.via.relationshipType.toLowerCase()}</Text>
                  </View>
                </TouchableOpacity>
                {canAdmin && selected && (
                  <TouchableOpacity
                    className="flex-row items-center mt-2 ml-7"
                    onPress={() => setAdminSuggestionIds((set) => toggle(set, s.person.id))}
                  >
                    <View style={{ width: 16, height: 16, borderRadius: 4, borderWidth: 2, borderColor: adminSuggestionIds.has(s.person.id) ? "#6366f1" : "#475569", backgroundColor: adminSuggestionIds.has(s.person.id) ? "#6366f1" : "transparent", marginRight: 8 }} />
                    <Text className="text-slate-400 text-xs">Make event admin</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      )}

      <View className="mb-6">
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-2">External guest</Text>
        <TextInput className="bg-slate-800 text-slate-50 rounded-xl px-4 py-3 mb-2" placeholder="Name" placeholderTextColor="#64748b" value={externalName} onChangeText={setExternalName} />
        <TextInput className="bg-slate-800 text-slate-50 rounded-xl px-4 py-3 mb-2" placeholder="Email address" placeholderTextColor="#64748b" autoCapitalize="none" keyboardType="email-address" value={externalEmail} onChangeText={setExternalEmail} />
        <TextInput className="bg-slate-800 text-slate-50 rounded-xl px-4 py-3" placeholder="Phone (optional)" placeholderTextColor="#64748b" keyboardType="phone-pad" value={externalPhone} onChangeText={setExternalPhone} />
      </View>

      {sendMutation.isSuccess && <Text className="text-green-400 text-sm mb-3">Invitations created</Text>}

      <TouchableOpacity
        onPress={handleSend}
        disabled={sendMutation.isPending}
        style={{ opacity: sendMutation.isPending ? 0.5 : 1, backgroundColor: "#4f46e5", borderRadius: 8, paddingVertical: 14, alignItems: "center" }}
      >
        <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>{sendMutation.isPending ? "Sending…" : "Send invitations"}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
```

Add the **Invite button** to `apps/mobile/components/events/OwnEventDetail.tsx`. Import `useRouter` from `expo-router` (`import { useRouter } from "expo-router";`), call `const router = useRouter();` in the component body, and render just under the event header (after the description, before the RSVP section):

```tsx
      <TouchableOpacity
        onPress={() => router.push(`/(tabs)/events/invite/${eventId}`)}
        style={{ alignSelf: "flex-start", backgroundColor: "#1e293b", borderColor: "#334155", borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 24 }}
      >
        <Text className="text-indigo-300 text-sm font-medium">+ Invite people</Text>
      </TouchableOpacity>
```

**Register the route** in `apps/mobile/app/(tabs)/events/_layout.tsx` — add this line inside `<Stack>` right after the `<Stack.Screen name="[eventId]" ... />` line:

```tsx
      <Stack.Screen name="invite/[eventId]" options={{ title: "Invite" }} />
```

**Fix the existing OwnEventDetail test** — `OwnEventDetail` now calls `useRouter()`, which will throw in `apps/mobile/__tests__/components/OwnEventDetail.test.tsx` if that file doesn't already mock `expo-router`. Read that test; if it lacks an `expo-router` mock, add one at the top:

```tsx
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
```

(Task 3 adds the remaining `useParticipants`/`useIsFamilyAdmin` mocks to that same file; adding only the `expo-router` mock here keeps Task 2's suite green.)

- [ ] **Step 4: Run tests + checks**

Run: `npm test --workspace=famlink-mobile -- __tests__/screens/invite.test.tsx` → PASS (4).
Run: full mobile suite `npm test --workspace=famlink-mobile` → PASS.
Run: `npm run type-check --workspace=famlink-mobile` + `npm run lint --workspace=famlink-mobile` → clean / 0 errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/mobile/app/(tabs)/events/invite/[eventId].tsx" "apps/mobile/app/(tabs)/events/_layout.tsx" apps/mobile/components/events/OwnEventDetail.tsx apps/mobile/__tests__/screens/invite.test.tsx apps/mobile/__tests__/components/OwnEventDetail.test.tsx
git commit -m "feat: P3-03 mobile invite screen + Invite button on own-event detail"
```

---

### Task 3: Participant management section on `OwnEventDetail`

**Files:**
- Modify: `apps/mobile/components/events/OwnEventDetail.tsx`
- Test: `apps/mobile/__tests__/components/OwnEventDetail.participants.test.tsx` (new file, to keep the existing `OwnEventDetail.test.tsx` focused)

**Interfaces:**
- Consumes: Task 1's `useParticipants`, `useRevokeParticipant`, `useSetParticipantRole`, `ParticipantRecord`, `useIsFamilyAdmin`; `detail.event.familyGroupId`.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test** — create `apps/mobile/__tests__/components/OwnEventDetail.participants.test.tsx`:

```tsx
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { Alert } from "react-native";
import OwnEventDetail from "../../components/events/OwnEventDetail";
import type { EventDetail } from "../../hooks/useEvents";

// Revoke is behind a native confirm dialog. Auto-invoke the destructive button so
// pressing "Revoke" exercises the mutation (mirrors PR-1's Alert-backed delete tests).
jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
  const destructive = (buttons ?? []).find((b) => b.style === "destructive");
  destructive?.onPress?.();
});

const mockRevoke = jest.fn();
const mockSetRole = jest.fn();
jest.mock("@clerk/clerk-expo", () => ({ useAuth: () => ({ getToken: jest.fn() }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("../../hooks/useEvents", () => ({
  ...jest.requireActual("../../hooks/useEvents"),
  useRsvp: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
  useAddItem: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
  useDeleteItem: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
  useClaimItem: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
  useParticipants: jest.fn(() => ({ data: { participants: [
    { personId: "p1", displayName: "Active One", role: "PARTICIPANT", status: "ACTIVE" },
    { personId: "p2", displayName: "Revoked Two", role: "EVENT_ADMIN", status: "REVOKED" },
  ] } })),
  useRevokeParticipant: jest.fn(() => ({ mutate: mockRevoke, isPending: false })),
  useSetParticipantRole: jest.fn(() => ({ mutate: mockSetRole, isPending: false })),
}));
jest.mock("../../hooks/useFamily", () => ({
  useMyPerson: jest.fn(() => ({ data: { id: "me1" } })),
  useIsFamilyAdmin: jest.fn(() => true),
}));
jest.mock("../../hooks/usePhotos", () => ({
  useEventPhotos: jest.fn(() => ({ data: [] })),
  useUploadEventPhoto: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
  useDeletePhoto: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
}));

const detail: EventDetail = {
  event: { id: "e1", familyGroupId: "famA", createdByPersonId: "p0", title: "T", description: null, startAt: "2026-07-08T18:00:00.000Z", endAt: null, locationName: null, locationAddress: null, locationMapUrl: null, visibility: "FAMILY", isRecurring: false, isBirthdayEvent: false, birthdayPersonId: null, createdAt: "", updatedAt: "" },
  invitations: 0, rsvps: { YES: 0, NO: 0, MAYBE: 0, PENDING: 0 }, eventItems: [],
};

describe("OwnEventDetail participants", () => {
  beforeEach(() => { mockRevoke.mockClear(); mockSetRole.mockClear(); });

  it("lists active and revoked participants (revoked shown as history)", () => {
    render(<OwnEventDetail eventId="e1" detail={detail} />);
    expect(screen.getByText("Active One")).toBeTruthy();
    expect(screen.getByText("Revoked Two")).toBeTruthy();
  });

  it("admin can revoke an active participant (through the confirm dialog)", () => {
    render(<OwnEventDetail eventId="e1" detail={detail} />);
    fireEvent.press(screen.getByText("Revoke"));   // only the ACTIVE row has a Revoke action
    expect(mockRevoke).toHaveBeenCalledWith("p1");
  });

  it("admin can toggle an active participant's role", () => {
    render(<OwnEventDetail eventId="e1" detail={detail} />);
    fireEvent.press(screen.getByText("Make admin")); // p1 is PARTICIPANT → promote
    expect(mockSetRole).toHaveBeenCalledWith({ personId: "p1", role: "EVENT_ADMIN" });
  });

  it("hides revoke/role actions for a non-admin viewer", () => {
    const { useIsFamilyAdmin } = require("../../hooks/useFamily");
    (useIsFamilyAdmin as jest.Mock).mockReturnValue(false);
    render(<OwnEventDetail eventId="e1" detail={detail} />);
    expect(screen.getByText("Active One")).toBeTruthy();  // list still visible
    expect(screen.queryByText("Revoke")).toBeNull();      // actions gone
    (useIsFamilyAdmin as jest.Mock).mockReturnValue(true); // restore for other tests
  });
});
```

Note: after Task 3, `OwnEventDetail` calls `useParticipants`, `useRevokeParticipant`, `useSetParticipantRole`, and `useIsFamilyAdmin` unconditionally. The existing `OwnEventDetail.test.tsx` spreads the real `useEvents` module via `jest.requireActual`, so any hook it does NOT override runs for real (calling `useMutation`/`useApiFetch` with no provider → throws). **Update the existing `OwnEventDetail.test.tsx`** in Step 3 to add ALL of these to its mocks: `useParticipants: jest.fn(() => ({ data: { participants: [] } }))`, `useRevokeParticipant: jest.fn(() => ({ mutate: jest.fn(), isPending: false }))`, `useSetParticipantRole: jest.fn(() => ({ mutate: jest.fn(), isPending: false }))` (in the `useEvents` mock) and `useIsFamilyAdmin: jest.fn(() => false)` (in the `useFamily` mock). Empty participants + non-admin means the section renders nothing, so its existing cases are unaffected.

- [ ] **Step 2: Run to verify failure**

Run: `npm test --workspace=famlink-mobile -- __tests__/components/OwnEventDetail.participants.test.tsx`
Expected: FAIL — no participants section rendered.

- [ ] **Step 3: Implement the Participants section** — in `apps/mobile/components/events/OwnEventDetail.tsx`:

Add imports/hooks at the top of the component:
```tsx
import { useParticipants, useRevokeParticipant, useSetParticipantRole } from "../../hooks/useEvents";
import { useIsFamilyAdmin } from "../../hooks/useFamily";
// in the component body:
const participantsQuery = useParticipants(eventId);
const revokeMutation = useRevokeParticipant(eventId);
const setRoleMutation = useSetParticipantRole(eventId);
const canAdmin = useIsFamilyAdmin(detail.event.familyGroupId);
```

Render a Participants section (place it after the items section, before Photos):
```tsx
      {(participantsQuery.data?.participants.length ?? 0) > 0 && (
        <View className="mb-8">
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">Participants</Text>
          {participantsQuery.data!.participants.map((p) => {
            const revoked = p.status === "REVOKED";
            return (
              <View key={p.personId} className="bg-slate-800 rounded-xl px-4 py-3 mb-2 flex-row items-center justify-between" style={{ opacity: revoked ? 0.5 : 1 }}>
                <View className="flex-1 mr-3">
                  <Text className="text-slate-50 font-medium">{p.displayName}</Text>
                  <Text className="text-slate-500 text-xs">{p.role === "EVENT_ADMIN" ? "Event admin" : "Participant"}{revoked ? " · revoked" : ""}</Text>
                </View>
                {canAdmin && !revoked && (
                  <View className="flex-row items-center">
                    <TouchableOpacity
                      onPress={() => setRoleMutation.mutate({ personId: p.personId, role: p.role === "EVENT_ADMIN" ? "PARTICIPANT" : "EVENT_ADMIN" })}
                      disabled={setRoleMutation.isPending}
                      style={{ marginRight: 12 }}
                    >
                      <Text className="text-indigo-300 text-sm">{p.role === "EVENT_ADMIN" ? "Make participant" : "Make admin"}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => Alert.alert("Revoke participant?", p.displayName, [
                        { text: "Cancel", style: "cancel" },
                        { text: "Revoke", style: "destructive", onPress: () => revokeMutation.mutate(p.personId) },
                      ])}
                      disabled={revokeMutation.isPending}
                    >
                      <Text className="text-red-400 text-sm">Revoke</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
```

Then update the existing `apps/mobile/__tests__/components/OwnEventDetail.test.tsx` per the Step-1 note (add `useParticipants`, `useRevokeParticipant`, `useSetParticipantRole` to its `useEvents` mock and `useIsFamilyAdmin` to its `useFamily` mock) so its existing cases keep rendering. (The `expo-router` mock was already added in Task 2.)

- [ ] **Step 4: Run tests + checks**

Run: `npm test --workspace=famlink-mobile -- __tests__/components/OwnEventDetail.participants.test.tsx __tests__/components/OwnEventDetail.test.tsx` → PASS.
Run: full mobile suite `npm test --workspace=famlink-mobile` → PASS.
Run: `npm run type-check --workspace=famlink-mobile` + `npm run lint --workspace=famlink-mobile` → clean / 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/events/OwnEventDetail.tsx apps/mobile/__tests__/components/OwnEventDetail.participants.test.tsx apps/mobile/__tests__/components/OwnEventDetail.test.tsx
git commit -m "feat: P3-03 mobile participant management (list + admin revoke/role) on own-event detail"
```

---

### Task 4: Final verification

**Files:** none (verify-only; fix-forward with `fix: P3-03 ...` and re-report if anything is red).

- [ ] **Step 1: Full mobile suite** — `npm test --workspace=famlink-mobile` → ALL PASS; note any new console warnings.
- [ ] **Step 2: Full API suite** — `npm test --workspace=@famlink/api -- --run` → ALL PASS (should be unchanged; guards against accidental cross-workspace edits).
- [ ] **Step 3: Web suite + coverage** — `npm test --workspace=famlink-web -- --coverage` → PASS, coverage ≥ 80% (web untouched). If it fails on a local `@vitejs/plugin-react` resolution error, run `npm install` first (pre-existing local env gap; not a code issue) then re-run.
- [ ] **Step 4: Repo-root type-check** — `npm run type-check` → 6/6 clean.
- [ ] **Step 5: Repo-root lint** — `npm run lint` → 0 errors (pre-existing warnings only).
- [ ] **Step 6: Whitespace** — `git diff main --check` → clean (CRLF false positives per repo convention are acceptable).
- [ ] **Step 7: GitNexus scope** — `mcp__gitnexus__detect_changes({scope: "compare", base_ref: "main"})`; confirm affected files are confined to `apps/mobile/**` (hooks, the invite screen, `OwnEventDetail`, tests). Flag anything unexpected. (If the index still carries the phantom `p3-03-w3a-ui-web` primary-slot label, pass `--branch main`.)
- [ ] **Step 8: Report** the evidence table (suite counts, type-check/lint status) for the whole-branch review gate.

---

## Self-Review (completed at write time)

- **Spec coverage (§5):** §5.1 invite screen (members → Task 2; suggestions + admin-gated role toggle → Task 2; external guest + neutral "Invitations created" copy → Task 2; `useSendInvitations` tagged array → Task 1) ; §5.2 participant management (list incl. REVOKED muted → Task 3; admin revoke/role → Task 3; owning-member-only endpoint → Task 3 renders only in `OwnEventDetail`; `canAdmin` = family roles via `useIsFamilyAdmin` → Task 1). §6 isolation carried (display names only; invite reachable only from own-event detail). §7 CI already covers mobile (PR 1) — no change.
- **Placeholder scan:** no TBD/TODO; every code step has complete code; the two OwnEventDetail edits (Invite button in Task 2, Participants section in Task 3) are separated by task and both show full JSX.
- **Type consistency:** `InviteeEntry`/`InviteeSuggestion`/`ParticipantRecord` defined in Task 1 and consumed with identical shapes in Tasks 2–3; `useIsFamilyAdmin(familyGroupId)` signature identical across Task 1 definition and Task 2/3 use; hook names (`useSendInvitations`, `useParticipants`, `useRevokeParticipant`, `useSetParticipantRole`, `useInviteeSuggestions`) identical throughout; the mutation arg shapes in tests match the implementations (`mutate(personId)`, `mutate({personId, role})`, `mutate(invitees)`).
- **Known cross-task edit:** `OwnEventDetail` is modified in both Task 2 (Invite button + `useRouter`) and Task 3 (Participants section + participant hooks). Both tasks update the existing `OwnEventDetail.test.tsx` mocks so its cases keep rendering: Task 2 adds the `expo-router` mock, Task 3 adds the `useParticipants`/`useIsFamilyAdmin` mocks — called out explicitly in each.

## Council review (Codex, 2026-07-06)

Round 1: 2 BLOCKERs, 7 MAJORs, MINORs/NITs. Fixed: (BLOCKER) GitNexus rule — Global Constraints now require `impact()` on `OwnEventDetail` before its edits, not an exception; (BLOCKER) Task-3 revoke test — the revoke is behind `Alert.alert`, so the test now mocks `Alert.alert` to auto-invoke the destructive callback (mirrors PR-1's delete tests); (MAJOR) `_layout.tsx` Stack.Screen registration made an explicit Task-2 step; (MAJOR) invite screen now guards `familyGroupId === null` (foreign/missing event → "can't be managed here"); (MAJOR) invite test asserts `mutate(invitees, {onSuccess})` with the options arg; (MAJOR) Task 2 adds the `expo-router` mock to the existing `OwnEventDetail.test.tsx`; (MAJOR) `useSendInvitations` now also invalidates `invitee-suggestions` + `participants`; (MINOR) added toggle-appears-only-after-selection and role-toggle tests. Adjudicated as not-a-defect: `useMembers(null)` is supported (`enabled: familyId !== null`, verified); the `mutate`-in-`act` test pattern is the established repo pattern (PR-1's suites pass with it); the non-admin `famlinkUser` → 403 behavior is intentional **web parity** (spec §5.1 "copy web's shipped behavior") — pre-existing, not introduced here; non-ASCII `·`/`…` match existing mobile files' charset.

Round 2: 0 BLOCKERs, 2 MAJORs — **converged**. Both fixed: (1) the existing `OwnEventDetail.test.tsx` must mock ALL four participant hooks (`useParticipants`/`useRevokeParticipant`/`useSetParticipantRole`/`useIsFamilyAdmin`), else `jest.requireActual` runs the real mutation hooks with no provider — Task 3 note expanded; (2) `useInviteeSuggestions` now takes an `enabled` option and the invite screen gates it on `!!familyGroupId`, so a foreign/missing event never fires the suggestions request (guard was render-only before). Plus a cosmetic test-count fix (invite suite is 4, not 3). Findings strictly downgraded round-1→round-2, so the review is closed per the two-round convergence rule.
