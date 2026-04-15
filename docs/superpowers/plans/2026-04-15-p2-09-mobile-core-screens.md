# P2-09 Mobile Core Screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the React Native mobile app for FamLink Phase 2 — auth, family directory, events (participant flows), calendar, and AI assistant — using Expo Router, Clerk Expo, and TanStack Query.

**Architecture:** Fixed 4-tab navigation (Family / Events / Calendar / Assistant) with per-tab Stack navigators for drill-down. TanStack Query handles all data fetching with a 10-second configurable polling interval. Clerk Expo SDK handles auth with SecureStore token persistence. The AI assistant uses `@ai-sdk/react` `useChat` with a custom transport that calls the Express API directly with a Bearer token.

**Tech Stack:** Expo 51, Expo Router 3, `@clerk/clerk-expo`, `expo-secure-store`, `@tanstack/react-query`, `@ai-sdk/react`, NativeWind 4, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-15-p2-09-mobile-core-screens-design.md`

---

## File Map

**New files:**
- `apps/mobile/app.config.js` — Expo config with env var exposure
- `apps/mobile/lib/config.ts` — `REFRESH_INTERVAL_MS` and other constants
- `apps/mobile/lib/api.ts` — `useApiFetch()` authenticated fetch hook
- `apps/mobile/providers/QueryProvider.tsx` — TanStack QueryClient with global `refetchInterval`
- `apps/mobile/hooks/useFamily.ts` — `useMyFamilies()`, `useMembers()`, `usePerson(id)`, `usePersonRelationships(id)`
- `apps/mobile/hooks/useEvents.ts` — `useEvents()`, `useEvent(id)`, `useRsvp()` mutation, `useClaimItem()` mutation
- `apps/mobile/hooks/useCalendar.ts` — `useCalendarMonth(familyId, year, month)`, `useCalendarDay(familyId, date)`
- `apps/mobile/app/(auth)/_layout.tsx` — Stack navigator for auth flow
- `apps/mobile/app/(auth)/sign-in.tsx` — Email + password sign-in
- `apps/mobile/app/(auth)/sign-up.tsx` — Email + password + name sign-up
- `apps/mobile/app/(tabs)/_layout.tsx` — Bottom tab navigator (4 tabs)
- `apps/mobile/app/(tabs)/family/_layout.tsx` — Family stack
- `apps/mobile/app/(tabs)/family/index.tsx` — Member directory
- `apps/mobile/app/(tabs)/family/[personId].tsx` — Person profile
- `apps/mobile/app/(tabs)/events/_layout.tsx` — Events stack
- `apps/mobile/app/(tabs)/events/index.tsx` — Events list
- `apps/mobile/app/(tabs)/events/[eventId].tsx` — Event detail + RSVP + EventItems
- `apps/mobile/app/(tabs)/calendar/_layout.tsx` — Calendar stack
- `apps/mobile/app/(tabs)/calendar/index.tsx` — Monthly grid
- `apps/mobile/app/(tabs)/calendar/[date].tsx` — Day view
- `apps/mobile/app/(tabs)/assistant/_layout.tsx` — Assistant stack
- `apps/mobile/app/(tabs)/assistant/index.tsx` — AI chat interface
- `apps/mobile/__tests__/lib/api.test.ts`
- `apps/mobile/__tests__/hooks/useFamily.test.ts`
- `apps/mobile/__tests__/hooks/useEvents.test.ts`
- `apps/mobile/__tests__/hooks/useCalendar.test.ts`

**Modified files:**
- `apps/mobile/app/_layout.tsx` — add ClerkProvider + QueryProvider
- `apps/mobile/app/index.tsx` — add auth redirect
- `apps/mobile/jest.config.js` — add new packages to `transformIgnorePatterns`, fix `collectCoverageFrom`
- `apps/mobile/package.json` — new dependencies

---

## Task 1: Install dependencies + project config

**Files:**
- Modify: `apps/mobile/package.json`
- Create: `apps/mobile/app.config.js`
- Modify: `apps/mobile/jest.config.js`

- [ ] **Step 1: Install dependencies**

From `apps/mobile`:
```bash
npm install @clerk/clerk-expo expo-secure-store @tanstack/react-query @ai-sdk/react ai
```

- [ ] **Step 2: Verify installation**

```bash
npm ls @clerk/clerk-expo expo-secure-store @tanstack/react-query @ai-sdk/react ai --depth=0
```

Expected: all five packages listed with versions, no `UNMET DEPENDENCY` errors.

- [ ] **Step 3: Create app.config.js**

Create `apps/mobile/app.config.js`:
```js
module.exports = {
  name: "FamLink",
  slug: "famlink",
  version: "1.0.0",
  orientation: "portrait",
  scheme: "famlink",
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001",
    clerkPublishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "",
  },
};
```

- [ ] **Step 4: Create .env file**

Create `apps/mobile/.env` (not committed — already gitignored via root `.gitignore`):
```
EXPO_PUBLIC_API_URL=http://localhost:3001
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_key_here
```

> The Clerk publishable key is in the web app's `.env.local` as `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — use the same value.

- [ ] **Step 5: Update jest.config.js to include new packages in transform**

Replace `apps/mobile/jest.config.js`:
```js
module.exports = {
  preset: "jest-expo",
  passWithNoTests: true,
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@clerk/clerk-expo|expo-secure-store)"
  ],
  coverageThreshold: { global: { lines: 80 } },
  collectCoverageFrom: [
    "app/**/*.{ts,tsx}",
    "hooks/**/*.{ts,tsx}",
    "lib/**/*.{ts,tsx}",
    "providers/**/*.{ts,tsx}",
    "!**/__tests__/**"
  ]
};
```

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/package.json apps/mobile/package-lock.json apps/mobile/app.config.js apps/mobile/jest.config.js
git commit -m "chore: P2-09 install mobile deps + project config"
```

---

## Task 2: Foundation — config, API client, QueryProvider

**Files:**
- Create: `apps/mobile/lib/config.ts`
- Create: `apps/mobile/lib/api.ts`
- Create: `apps/mobile/providers/QueryProvider.tsx`
- Create: `apps/mobile/__tests__/lib/api.test.ts`

- [ ] **Step 1: Write failing tests for lib/api.ts**

Create `apps/mobile/__tests__/lib/api.test.ts`:
```ts
import { renderHook } from "@testing-library/react-native";
import { useApiFetch } from "../../lib/api";

jest.mock("@clerk/clerk-expo", () => ({
  useAuth: () => ({ getToken: jest.fn().mockResolvedValue("test-token") }),
}));

describe("useApiFetch", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: "ok" }),
    });
    process.env.EXPO_PUBLIC_API_URL = "http://localhost:3001";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("calls the API with Authorization header", async () => {
    const { result } = renderHook(() => useApiFetch());
    await result.current("/test");
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/test",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      })
    );
  });

  it("throws on non-ok response", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: "Forbidden" }),
    });
    const { result } = renderHook(() => useApiFetch());
    await expect(result.current("/test")).rejects.toThrow("API 403: Forbidden");
  });

  it("prepends base URL to path", async () => {
    const { result } = renderHook(() => useApiFetch());
    await result.current("/api/v1/persons/me");
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/persons/me",
      expect.anything()
    );
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd apps/mobile && npm test -- --testPathPattern="__tests__/lib/api"
```

Expected: FAIL — `Cannot find module '../../lib/api'`

- [ ] **Step 3: Create lib/config.ts**

Create `apps/mobile/lib/config.ts`:
```ts
/** Polling interval for TanStack Query refetchInterval (ms). */
export const REFRESH_INTERVAL_MS = 10_000;

export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";
```

- [ ] **Step 4: Create lib/api.ts**

Create `apps/mobile/lib/api.ts`:
```ts
import { useAuth } from "@clerk/clerk-expo";
import { API_BASE } from "./config";

export function useApiFetch() {
  const { getToken } = useAuth();

  return async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getToken();
    const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers(init?.headers);
    headers.set("Content-Type", "application/json");
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    const res = await fetch(url, { ...init, headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (json as { error?: string }).error ?? `HTTP ${res.status}`;
      throw new Error(`API ${res.status}: ${msg}`);
    }
    return json as T;
  };
}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd apps/mobile && npm test -- --testPathPattern="__tests__/lib/api"
```

Expected: PASS — 3 tests

- [ ] **Step 6: Create providers/QueryProvider.tsx**

Create `apps/mobile/providers/QueryProvider.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { REFRESH_INTERVAL_MS } from "../lib/config";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: REFRESH_INTERVAL_MS,
      staleTime: 5_000,
      retry: 1,
    },
  },
});

export function QueryProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/lib/ apps/mobile/providers/ apps/mobile/__tests__/lib/
git commit -m "feat: P2-09 mobile foundation — config, apiFetch, QueryProvider"
```

---

## Task 3: Root layout + index redirect

**Files:**
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/app/index.tsx`

- [ ] **Step 1: Update root layout**

Replace `apps/mobile/app/_layout.tsx`:
```tsx
import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import * as SecureStore from "expo-secure-store";
import { Stack } from "expo-router";
import { QueryProvider } from "../providers/QueryProvider";
import type { ReactNode } from "react";

const tokenCache = {
  async getToken(key: string) {
    return SecureStore.getItemAsync(key);
  },
  async saveToken(key: string, value: string) {
    return SecureStore.setItemAsync(key, value);
  },
  async clearToken(key: string) {
    return SecureStore.deleteItemAsync(key);
  },
};

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

export default function RootLayout(): ReactNode {
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <QueryProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </QueryProvider>
    </ClerkProvider>
  );
}
```

- [ ] **Step 2: Update index redirect**

Replace `apps/mobile/app/index.tsx`:
```tsx
import { Redirect } from "expo-router";
import { useAuth } from "@clerk/clerk-expo";
import { View, ActivityIndicator } from "react-native";
import type { ReactElement } from "react";

export default function Index(): ReactElement {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-950">
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  return <Redirect href={isSignedIn ? "/(tabs)/events" : "/(auth)/sign-in"} />;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/_layout.tsx apps/mobile/app/index.tsx
git commit -m "feat: P2-09 root layout with ClerkProvider + QueryProvider + auth redirect"
```

---

## Task 4: Auth screens

**Files:**
- Create: `apps/mobile/app/(auth)/_layout.tsx`
- Create: `apps/mobile/app/(auth)/sign-in.tsx`
- Create: `apps/mobile/app/(auth)/sign-up.tsx`

- [ ] **Step 1: Create auth stack layout**

Create `apps/mobile/app/(auth)/_layout.tsx`:
```tsx
import { Stack } from "expo-router";
import type { ReactNode } from "react";

export default function AuthLayout(): ReactNode {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
    </Stack>
  );
}
```

- [ ] **Step 2: Create sign-in screen**

Create `apps/mobile/app/(auth)/sign-in.tsx`:
```tsx
import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { useSignIn } from "@clerk/clerk-expo";
import { useRouter, Link } from "expo-router";
import type { ReactElement } from "react";

export default function SignIn(): ReactElement {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    if (!isLoaded) return;
    setLoading(true);
    setError(null);
    try {
      const result = await signIn.create({ identifier: email, password });
      await setActive({ session: result.createdSessionId });
      router.replace("/(tabs)/events");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sign in failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View className="flex-1 bg-slate-950 px-6 justify-center">
      <Text className="text-2xl font-bold text-slate-50 mb-8">Sign in to FamLink</Text>

      {error && (
        <View className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 mb-4">
          <Text className="text-red-300 text-sm">{error}</Text>
        </View>
      )}

      <Text className="text-slate-400 text-sm mb-1">Email</Text>
      <TextInput
        className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-slate-50 mb-4"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        placeholderTextColor="#64748b"
        placeholder="you@example.com"
      />

      <Text className="text-slate-400 text-sm mb-1">Password</Text>
      <TextInput
        className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-slate-50 mb-6"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        placeholderTextColor="#64748b"
        placeholder="••••••••"
      />

      <TouchableOpacity
        onPress={handleSignIn}
        disabled={loading || !email || !password}
        className="bg-indigo-600 rounded-lg py-3 items-center mb-4"
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-white font-semibold">Sign in</Text>
        )}
      </TouchableOpacity>

      <Link href="/(auth)/sign-up" asChild>
        <TouchableOpacity className="items-center">
          <Text className="text-slate-400">
            No account?{" "}
            <Text className="text-indigo-400">Sign up</Text>
          </Text>
        </TouchableOpacity>
      </Link>
    </View>
  );
}
```

- [ ] **Step 3: Create sign-up screen**

Create `apps/mobile/app/(auth)/sign-up.tsx`:
```tsx
import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { useSignUp } from "@clerk/clerk-expo";
import { useRouter, Link } from "expo-router";
import type { ReactElement } from "react";

export default function SignUp(): ReactElement {
  const { signUp, setActive, isLoaded } = useSignUp();
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignUp() {
    if (!isLoaded) return;
    setLoading(true);
    setError(null);
    try {
      const result = await signUp.create({ firstName, lastName, emailAddress: email, password });
      await setActive({ session: result.createdSessionId });
      router.replace("/(tabs)/events");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sign up failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = firstName && lastName && email && password && !loading;

  return (
    <View className="flex-1 bg-slate-950 px-6 justify-center">
      <Text className="text-2xl font-bold text-slate-50 mb-8">Create your account</Text>

      {error && (
        <View className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 mb-4">
          <Text className="text-red-300 text-sm">{error}</Text>
        </View>
      )}

      <View className="flex-row gap-3 mb-4">
        <View className="flex-1">
          <Text className="text-slate-400 text-sm mb-1">First name</Text>
          <TextInput
            className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-slate-50"
            value={firstName}
            onChangeText={setFirstName}
            autoCapitalize="words"
            placeholderTextColor="#64748b"
            placeholder="Jane"
          />
        </View>
        <View className="flex-1">
          <Text className="text-slate-400 text-sm mb-1">Last name</Text>
          <TextInput
            className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-slate-50"
            value={lastName}
            onChangeText={setLastName}
            autoCapitalize="words"
            placeholderTextColor="#64748b"
            placeholder="Smith"
          />
        </View>
      </View>

      <Text className="text-slate-400 text-sm mb-1">Email</Text>
      <TextInput
        className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-slate-50 mb-4"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        placeholderTextColor="#64748b"
        placeholder="you@example.com"
      />

      <Text className="text-slate-400 text-sm mb-1">Password</Text>
      <TextInput
        className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-slate-50 mb-6"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        placeholderTextColor="#64748b"
        placeholder="••••••••"
      />

      <TouchableOpacity
        onPress={handleSignUp}
        disabled={!canSubmit}
        className="bg-indigo-600 rounded-lg py-3 items-center mb-4"
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-white font-semibold">Create account</Text>
        )}
      </TouchableOpacity>

      <Link href="/(auth)/sign-in" asChild>
        <TouchableOpacity className="items-center">
          <Text className="text-slate-400">
            Already have an account?{" "}
            <Text className="text-indigo-400">Sign in</Text>
          </Text>
        </TouchableOpacity>
      </Link>
    </View>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/\(auth\)/
git commit -m "feat: P2-09 auth screens — sign-in + sign-up with Clerk Expo"
```

---

## Task 5: Tab navigator shell

**Files:**
- Create: `apps/mobile/app/(tabs)/_layout.tsx`
- Create: `apps/mobile/app/(tabs)/family/_layout.tsx`
- Create: `apps/mobile/app/(tabs)/events/_layout.tsx`
- Create: `apps/mobile/app/(tabs)/calendar/_layout.tsx`
- Create: `apps/mobile/app/(tabs)/assistant/_layout.tsx`

- [ ] **Step 1: Create the 4-tab bottom navigator**

Create `apps/mobile/app/(tabs)/_layout.tsx`:
```tsx
import { Tabs } from "expo-router";
import { useAuth } from "@clerk/clerk-expo";
import { Redirect } from "expo-router";
import { Text } from "react-native";
import type { ReactNode } from "react";

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Family: "👨‍👩‍👧",
    Events: "📅",
    Calendar: "🗓",
    Assistant: "🤖",
  };
  return (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>
      {icons[label] ?? "•"}
    </Text>
  );
}

export default function TabsLayout(): ReactNode {
  const { isSignedIn, isLoaded } = useAuth();

  if (isLoaded && !isSignedIn) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: "#0f172a", borderTopColor: "#1e293b" },
        tabBarActiveTintColor: "#6366f1",
        tabBarInactiveTintColor: "#64748b",
      }}
    >
      <Tabs.Screen
        name="family"
        options={{
          title: "Family",
          tabBarIcon: ({ focused }) => <TabIcon label="Family" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          title: "Events",
          tabBarIcon: ({ focused }) => <TabIcon label="Events" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "Calendar",
          tabBarIcon: ({ focused }) => <TabIcon label="Calendar" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="assistant"
        options={{
          title: "Assistant",
          tabBarIcon: ({ focused }) => <TabIcon label="Assistant" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
```

- [ ] **Step 2: Create per-tab stack layouts**

Create `apps/mobile/app/(tabs)/family/_layout.tsx`:
```tsx
import { Stack } from "expo-router";
import type { ReactNode } from "react";
export default function FamilyStack(): ReactNode {
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: "#0f172a" }, headerTintColor: "#f8fafc", headerTitleStyle: { color: "#f8fafc" } }}>
      <Stack.Screen name="index" options={{ title: "Family" }} />
      <Stack.Screen name="[personId]" options={{ title: "Profile" }} />
    </Stack>
  );
}
```

Create `apps/mobile/app/(tabs)/events/_layout.tsx`:
```tsx
import { Stack } from "expo-router";
import type { ReactNode } from "react";
export default function EventsStack(): ReactNode {
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: "#0f172a" }, headerTintColor: "#f8fafc", headerTitleStyle: { color: "#f8fafc" } }}>
      <Stack.Screen name="index" options={{ title: "Events" }} />
      <Stack.Screen name="[eventId]" options={{ title: "Event" }} />
    </Stack>
  );
}
```

Create `apps/mobile/app/(tabs)/calendar/_layout.tsx`:
```tsx
import { Stack } from "expo-router";
import type { ReactNode } from "react";
export default function CalendarStack(): ReactNode {
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: "#0f172a" }, headerTintColor: "#f8fafc", headerTitleStyle: { color: "#f8fafc" } }}>
      <Stack.Screen name="index" options={{ title: "Calendar" }} />
      <Stack.Screen name="[date]" options={{ title: "Day" }} />
    </Stack>
  );
}
```

Create `apps/mobile/app/(tabs)/assistant/_layout.tsx`:
```tsx
import { Stack } from "expo-router";
import type { ReactNode } from "react";
export default function AssistantStack(): ReactNode {
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: "#0f172a" }, headerTintColor: "#f8fafc", headerTitleStyle: { color: "#f8fafc" } }}>
      <Stack.Screen name="index" options={{ title: "Assistant" }} />
    </Stack>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/\(tabs\)/
git commit -m "feat: P2-09 tab navigator shell + per-tab stack layouts"
```

---

## Task 6: Family hooks + screens

**Files:**
- Create: `apps/mobile/hooks/useFamily.ts`
- Create: `apps/mobile/app/(tabs)/family/index.tsx`
- Create: `apps/mobile/app/(tabs)/family/[personId].tsx`
- Create: `apps/mobile/__tests__/hooks/useFamily.test.ts`

### API reference
- `GET /api/v1/persons/me/families` → `{ memberships: Array<{ familyGroup: { id, name }, roles, joinedAt }> }`
- `GET /api/v1/families/:familyId` → `{ familyGroup, members: Array<{ person: PersonBrief, roles, joinedAt }>, households }`
- `GET /api/v1/persons/:personId` → `{ id, firstName, lastName, preferredName, dateOfBirth, profilePhotoUrl, ... }`
- `GET /api/v1/persons/:personId/relationships` → `Array<{ id, fromPersonId, toPersonId, type, relatedPerson: { displayName, ageGateLevel } }>`

### PersonBrief shape (from `/api/v1/families/:id`):
```ts
{ id, userId, firstName, lastName, preferredName, dateOfBirth, ageGateLevel, profilePhotoUrl, createdAt, updatedAt }
```

- [ ] **Step 1: Write failing tests for useFamily hooks**

Create `apps/mobile/__tests__/hooks/useFamily.test.ts`:
```ts
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import React from "react";
import { useMembers, useMyFamilies, useMyPerson, usePerson } from "../../hooks/useFamily";

jest.mock("../../lib/api", () => ({
  useApiFetch: jest.fn(),
}));

import { useApiFetch } from "../../lib/api";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useMyFamilies", () => {
  it("fetches /api/v1/persons/me/families", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ memberships: [{ familyGroup: { id: "fam1", name: "Smiths" }, roles: ["MEMBER"], joinedAt: "2025-01-01T00:00:00.000Z" }] });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useMyFamilies(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/persons/me/families");
    expect(result.current.data?.memberships[0].familyGroup.id).toBe("fam1");
  });
});

describe("useMembers", () => {
  it("fetches /api/v1/families/:familyId", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      familyGroup: { id: "fam1", name: "Smiths" },
      members: [{ person: { id: "p1", firstName: "Jane", lastName: "Smith", preferredName: null, dateOfBirth: null, ageGateLevel: "NONE", profilePhotoUrl: null, createdAt: "", updatedAt: "" }, roles: ["MEMBER"], joinedAt: "" }],
      households: []
    });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useMembers("fam1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/families/fam1");
    expect(result.current.data?.members[0].person.firstName).toBe("Jane");
  });

  it("is disabled when familyId is null", () => {
    const mockFetch = jest.fn();
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useMembers(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("usePerson", () => {
  it("fetches /api/v1/persons/:personId", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ id: "p1", firstName: "Jane", lastName: "Smith" });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => usePerson("p1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/persons/p1");
  });
});

describe("useMyPerson", () => {
  it("fetches /api/v1/persons/me", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ id: "p1", firstName: "Jane", lastName: "Smith" });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useMyPerson(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/persons/me");
    expect(result.current.data?.id).toBe("p1");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd apps/mobile && npm test -- --testPathPattern="__tests__/hooks/useFamily"
```

Expected: FAIL — `Cannot find module '../../hooks/useFamily'`

- [ ] **Step 3: Create hooks/useFamily.ts**

Create `apps/mobile/hooks/useFamily.ts`:
```ts
import { useQuery } from "@tanstack/react-query";
import { useApiFetch } from "../lib/api";

interface PersonBrief {
  id: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  dateOfBirth: string | null;
  ageGateLevel: string;
  profilePhotoUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FamilyMembership {
  familyGroup: { id: string; name: string };
  roles: string[];
  joinedAt: string;
}

export interface FamilyMember {
  person: PersonBrief;
  roles: string[];
  joinedAt: string;
}

interface FamilyDetail {
  familyGroup: { id: string; name: string; aiEnabled: boolean };
  members: FamilyMember[];
  households: Array<{
    household: { id: string; name: string };
    members: PersonBrief[];
  }>;
}

interface PersonRelationship {
  id: string;
  fromPersonId: string;
  toPersonId: string;
  type: string;
  relatedPerson: { displayName: string; ageGateLevel: string };
}

export function useMyFamilies() {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["families"],
    queryFn: () => apiFetch<{ memberships: FamilyMembership[] }>("/api/v1/persons/me/families"),
  });
}

export function useMembers(familyId: string | null) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["family", familyId],
    queryFn: () => apiFetch<FamilyDetail>(`/api/v1/families/${familyId}`),
    enabled: familyId !== null,
    refetchInterval: 10_000,
  });
}

export function usePerson(personId: string) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["person", personId],
    queryFn: () => apiFetch<PersonBrief>(`/api/v1/persons/${personId}`),
    refetchInterval: false,
  });
}

export function useMyPerson() {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<PersonBrief>("/api/v1/persons/me"),
    refetchInterval: false,
  });
}

export function usePersonRelationships(personId: string) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["person-relationships", personId],
    queryFn: () => apiFetch<PersonRelationship[]>(`/api/v1/persons/${personId}/relationships`),
    refetchInterval: false,
  });
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cd apps/mobile && npm test -- --testPathPattern="__tests__/hooks/useFamily"
```

Expected: PASS — 3 tests

- [ ] **Step 5: Create family/index.tsx**

Create `apps/mobile/app/(tabs)/family/index.tsx`:
```tsx
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useMyFamilies, useMembers, type FamilyMember } from "../../../hooks/useFamily";
import type { ReactElement } from "react";

function displayName(member: FamilyMember): string {
  const p = member.person;
  return p.preferredName?.trim() || `${p.firstName} ${p.lastName}`.trim();
}

export default function FamilyIndex(): ReactElement {
  const router = useRouter();
  const familiesQuery = useMyFamilies();
  const familyId = familiesQuery.data?.memberships[0]?.familyGroup.id ?? null;
  const membersQuery = useMembers(familyId);

  if (familiesQuery.isLoading || membersQuery.isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  if (membersQuery.isError) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center px-6">
        <Text className="text-slate-400 text-center">Failed to load family members.</Text>
      </View>
    );
  }

  const members = membersQuery.data?.members ?? [];

  return (
    <View className="flex-1 bg-slate-950">
      <FlatList
        data={members}
        keyExtractor={(item) => item.person.id}
        contentContainerStyle={{ padding: 16 }}
        ItemSeparatorComponent={() => <View className="h-2" />}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => router.push(`/(tabs)/family/${item.person.id}`)}
            className="bg-slate-800 rounded-xl px-4 py-4 flex-row items-center gap-4"
          >
            <View className="w-10 h-10 rounded-full bg-indigo-600 items-center justify-center">
              <Text className="text-white font-semibold text-base">
                {item.person.firstName[0]}{item.person.lastName[0]}
              </Text>
            </View>
            <View className="flex-1">
              <Text className="text-slate-50 font-medium">{displayName(item)}</Text>
              {/* OQ-1: secondary label deferred — household name shown when available */}
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
```

- [ ] **Step 6: Create family/[personId].tsx**

Create `apps/mobile/app/(tabs)/family/[personId].tsx`:
```tsx
import { View, Text, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { usePerson, usePersonRelationships } from "../../../hooks/useFamily";
import type { ReactElement } from "react";

const RELATIONSHIP_LABELS: Record<string, string> = {
  SPOUSE: "Spouse", PARTNER: "Partner", EX_SPOUSE: "Ex-spouse",
  PARENT: "Parent", CHILD: "Child", STEP_PARENT: "Step-parent",
  STEP_CHILD: "Step-child", ADOPTIVE_PARENT: "Adoptive parent",
  ADOPTIVE_CHILD: "Adoptive child", SIBLING: "Sibling",
  HALF_SIBLING: "Half-sibling", STEP_SIBLING: "Step-sibling",
  GRANDPARENT: "Grandparent", GRANDCHILD: "Grandchild",
  AUNT_UNCLE: "Aunt/Uncle", NIECE_NEPHEW: "Niece/Nephew",
  COUSIN: "Cousin", CAREGIVER: "Caregiver",
  GUARDIAN: "Guardian", FAMILY_FRIEND: "Family friend",
};

export default function PersonProfile(): ReactElement {
  const { personId } = useLocalSearchParams<{ personId: string }>();
  const personQuery = usePerson(personId);
  const relQuery = usePersonRelationships(personId);

  if (personQuery.isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  const person = personQuery.data;
  if (!person) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center px-6">
        <Text className="text-slate-400 text-center">Person not found.</Text>
      </View>
    );
  }

  const name = person.preferredName?.trim() || `${person.firstName} ${person.lastName}`.trim();
  const dob = person.dateOfBirth
    ? new Date(person.dateOfBirth).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : null;

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 24 }}>
      <View className="items-center mb-8">
        <View className="w-20 h-20 rounded-full bg-indigo-600 items-center justify-center mb-4">
          <Text className="text-white text-3xl font-semibold">
            {person.firstName[0]}{person.lastName[0]}
          </Text>
        </View>
        <Text className="text-slate-50 text-xl font-bold">{name}</Text>
        {name !== `${person.firstName} ${person.lastName}`.trim() && (
          <Text className="text-slate-400 text-sm mt-1">
            {person.firstName} {person.lastName}
          </Text>
        )}
      </View>

      {dob && (
        <View className="bg-slate-800 rounded-xl px-4 py-3 mb-4">
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-1">Birthday</Text>
          <Text className="text-slate-50">{dob}</Text>
        </View>
      )}

      {relQuery.data && relQuery.data.length > 0 && (
        <View className="bg-slate-800 rounded-xl px-4 py-3">
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">Relationships</Text>
          {relQuery.data.map((rel) => (
            <View key={rel.id} className="flex-row justify-between py-2 border-b border-slate-700 last:border-0">
              <Text className="text-slate-50">{rel.relatedPerson.displayName}</Text>
              <Text className="text-slate-400 text-sm">{RELATIONSHIP_LABELS[rel.type] ?? rel.type}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/hooks/useFamily.ts apps/mobile/app/\(tabs\)/family/ apps/mobile/__tests__/hooks/useFamily.test.ts
git commit -m "feat: P2-09 family hooks + screens — directory and person profile"
```

---

## Task 7: Events hooks + screens

**Files:**
- Create: `apps/mobile/hooks/useEvents.ts`
- Create: `apps/mobile/app/(tabs)/events/index.tsx`
- Create: `apps/mobile/app/(tabs)/events/[eventId].tsx`
- Create: `apps/mobile/__tests__/hooks/useEvents.test.ts`

### API reference
- `GET /api/v1/families/:familyId/calendar/upcoming?days=30` → `{ events: CalendarRow[], generatedAt }`
- `GET /api/v1/events/:eventId` → `{ event: SerializedEvent, invitations: number, rsvps: { YES, NO, MAYBE, PENDING }, eventItems: SerializedEventItem[] }`
- `PUT /api/v1/events/:eventId/rsvp` body: `{ status: "YES" | "NO" | "MAYBE" }` → `{ rsvp: RSVP }`
- `PUT /api/v1/events/:eventId/potluck` body: `SerializedEventItem[]` — bulk replace; not used for claim on mobile
- For claiming an item, the plan uses a PATCH-style approach via re-submitting the full potluck list with updated `assignedToPersonId`. See note in implementation.

> **Note on claiming EventItems:** The API does not have a dedicated claim endpoint — claiming is done via `PUT /api/v1/events/:eventId/potluck` which replaces the full items list. The `useClaimItem` mutation must: (1) fetch the current items list, (2) set `assignedToPersonId` on the target item, (3) PUT the full array. The query cache is invalidated after success.

### SerializedEvent shape:
```ts
{ id, familyGroupId, createdByPersonId, title, description, startAt, endAt, locationName, locationAddress, locationMapUrl, visibility, isRecurring, recurrenceRule, isBirthdayEvent, birthdayPersonId, createdAt, updatedAt }
```

### SerializedEventItem shape:
```ts
{ id, eventId, createdByPersonId, assignedToPersonId, name, quantity, notes, isChecklistItem, status, visibility, createdAt, updatedAt }
```

- [ ] **Step 1: Write failing tests**

Create `apps/mobile/__tests__/hooks/useEvents.test.ts`:
```ts
import { renderHook, waitFor, act } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { ReactNode } from "react";
import { useEvents, useEvent, useRsvp, useClaimItem } from "../../hooks/useEvents";

jest.mock("../../lib/api", () => ({ useApiFetch: jest.fn() }));
import { useApiFetch } from "../../lib/api";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false }, mutations: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

const mockEvent = { id: "e1", title: "Family Dinner", startAt: "2026-05-01T18:00:00.000Z", endAt: null, locationName: "Mom's House", isBirthdayEvent: false };

describe("useEvents", () => {
  it("fetches upcoming events for the family", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ events: [mockEvent], generatedAt: "" });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useEvents("fam1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/families/fam1/calendar/upcoming?days=30");
    expect(result.current.data?.events[0].title).toBe("Family Dinner");
  });

  it("is disabled when familyId is null", () => {
    const mockFetch = jest.fn();
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useEvents(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("useEvent", () => {
  it("fetches a single event by id", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      event: mockEvent,
      invitations: 5,
      rsvps: { YES: 3, NO: 1, MAYBE: 0, PENDING: 1 },
      eventItems: []
    });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useEvent("e1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/events/e1");
    expect(result.current.data?.event.title).toBe("Family Dinner");
  });
});

describe("useRsvp", () => {
  it("calls PUT /api/v1/events/:eventId/rsvp with status", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ rsvp: { status: "YES" } });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useRsvp("e1"), { wrapper });
    await act(async () => {
      result.current.mutate("YES");
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/events/e1/rsvp",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ status: "YES" }) })
    );
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd apps/mobile && npm test -- --testPathPattern="__tests__/hooks/useEvents"
```

Expected: FAIL — `Cannot find module '../../hooks/useEvents'`

- [ ] **Step 3: Create hooks/useEvents.ts**

Create `apps/mobile/hooks/useEvents.ts`:
```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiFetch } from "../lib/api";

export interface SerializedEvent {
  id: string;
  familyGroupId: string;
  createdByPersonId: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  locationName: string | null;
  locationAddress: string | null;
  locationMapUrl: string | null;
  visibility: string;
  isRecurring: boolean;
  isBirthdayEvent: boolean;
  birthdayPersonId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedEventItem {
  id: string;
  eventId: string;
  createdByPersonId: string;
  assignedToPersonId: string | null;
  name: string;
  quantity: string | null;
  notes: string | null;
  isChecklistItem: boolean;
  status: "UNCLAIMED" | "CLAIMED" | "PROVIDED" | "CANCELLED";
  visibility: string;
  createdAt: string;
  updatedAt: string;
}

export interface EventDetail {
  event: SerializedEvent;
  invitations: number;
  rsvps: { YES: number; NO: number; MAYBE: number; PENDING: number };
  eventItems: SerializedEventItem[];
}

export function useEvents(familyId: string | null) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["events", familyId],
    queryFn: () =>
      apiFetch<{ events: SerializedEvent[]; generatedAt: string }>(
        `/api/v1/families/${familyId}/calendar/upcoming?days=30`
      ),
    enabled: familyId !== null,
  });
}

export function useEvent(eventId: string) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["event", eventId],
    queryFn: () => apiFetch<EventDetail>(`/api/v1/events/${eventId}`),
  });
}

export function useRsvp(eventId: string) {
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: "YES" | "NO" | "MAYBE") =>
      apiFetch(`/api/v1/events/${eventId}/rsvp`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    },
  });
}

export function useClaimItem(eventId: string) {
  const apiFetch = useApiFetch();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemId,
      personId,
      currentItems,
    }: {
      itemId: string;
      personId: string;
      currentItems: SerializedEventItem[];
    }) => {
      const updated = currentItems.map((item) =>
        item.id === itemId ? { ...item, assignedToPersonId: personId } : item
      );
      return apiFetch(`/api/v1/events/${eventId}/potluck`, {
        method: "PUT",
        body: JSON.stringify(updated),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["event", eventId] });
    },
  });
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cd apps/mobile && npm test -- --testPathPattern="__tests__/hooks/useEvents"
```

Expected: PASS — 4 tests

- [ ] **Step 5: Create events/index.tsx**

Create `apps/mobile/app/(tabs)/events/index.tsx`:
```tsx
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useMyFamilies } from "../../../hooks/useFamily";
import { useEvents, type SerializedEvent } from "../../../hooks/useEvents";
import type { ReactElement } from "react";

const RSVP_COLORS: Record<string, string> = {
  YES: "#22c55e",
  NO: "#ef4444",
  MAYBE: "#f59e0b",
  PENDING: "#64748b",
};

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

export default function EventsIndex(): ReactElement {
  const router = useRouter();
  const familiesQuery = useMyFamilies();
  const familyId = familiesQuery.data?.memberships[0]?.familyGroup.id ?? null;
  const eventsQuery = useEvents(familyId);

  if (familiesQuery.isLoading || eventsQuery.isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  const events = eventsQuery.data?.events ?? [];

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
        renderItem={({ item }: { item: SerializedEvent }) => (
          <TouchableOpacity
            onPress={() => router.push(`/(tabs)/events/${item.id}`)}
            className="bg-slate-800 rounded-xl p-4"
          >
            <View className="flex-row justify-between items-start mb-1">
              <Text className="text-slate-50 font-semibold flex-1 mr-2">{item.title}</Text>
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

- [ ] **Step 6: Create events/[eventId].tsx**

Create `apps/mobile/app/(tabs)/events/[eventId].tsx`:
```tsx
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useEvent, useRsvp, useClaimItem } from "../../../hooks/useEvents";
import { useMyPerson } from "../../../hooks/useFamily";
import type { SerializedEventItem } from "../../../hooks/useEvents";
import type { ReactElement } from "react";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export default function EventDetail(): ReactElement {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const myPersonQuery = useMyPerson();
  const myPersonId = myPersonQuery.data?.id ?? null;
  const eventQuery = useEvent(eventId);
  const rsvpMutation = useRsvp(eventId);
  const claimMutation = useClaimItem(eventId);

  if (eventQuery.isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  if (!eventQuery.data) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center px-6">
        <Text className="text-slate-400 text-center">Event not found.</Text>
      </View>
    );
  }

  const { event, rsvps, eventItems } = eventQuery.data;

  function handleClaim(item: SerializedEventItem) {
    if (!myPersonId || claimMutation.isPending) return;
    claimMutation.mutate({ itemId: item.id, personId: myPersonId, currentItems: eventItems });
  }

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 24 }}>
      {/* Event header */}
      <Text className="text-slate-50 text-xl font-bold mb-2">{event.title}</Text>
      <Text className="text-slate-400 mb-4">{formatDateTime(event.startAt)}</Text>
      {event.locationName && (
        <Text className="text-slate-400 mb-4">📍 {event.locationName}</Text>
      )}
      {event.description && (
        <Text className="text-slate-300 mb-6">{event.description}</Text>
      )}

      {/* RSVP */}
      <View className="mb-8">
        <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">Your RSVP</Text>
        <View className="flex-row gap-3">
          {(["YES", "NO", "MAYBE"] as const).map((status) => (
            <TouchableOpacity
              key={status}
              onPress={() => rsvpMutation.mutate(status)}
              disabled={rsvpMutation.isPending}
              className="flex-1 py-2 rounded-lg items-center border border-slate-700"
              style={{ backgroundColor: status === "YES" ? "#15803d20" : status === "NO" ? "#b91c1c20" : "#92400e20" }}
            >
              <Text className={`font-semibold text-sm ${status === "YES" ? "text-green-400" : status === "NO" ? "text-red-400" : "text-amber-400"}`}>
                {status === "YES" ? "✓ Yes" : status === "NO" ? "✗ No" : "? Maybe"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View className="flex-row gap-4 mt-3">
          <Text className="text-slate-500 text-sm">{rsvps.YES} yes · {rsvps.NO} no · {rsvps.MAYBE} maybe · {rsvps.PENDING} pending</Text>
        </View>
      </View>

      {/* EventItems */}
      {eventItems.length > 0 && (
        <View>
          <Text className="text-slate-400 text-xs uppercase tracking-wider mb-3">What to bring</Text>
          {eventItems.map((item) => (
            <View key={item.id} className="bg-slate-800 rounded-xl px-4 py-3 mb-2 flex-row items-center justify-between">
              <View className="flex-1 mr-3">
                <Text className="text-slate-50 font-medium">{item.name}</Text>
                {item.quantity && <Text className="text-slate-400 text-sm">{item.quantity}</Text>}
                {item.assignedToPersonId && (
                  <Text className="text-green-400 text-xs mt-1">Claimed</Text>
                )}
              </View>
              {item.status === "UNCLAIMED" && (
                <TouchableOpacity
                  onPress={() => handleClaim(item)}
                  disabled={claimMutation.isPending}
                  className="bg-indigo-600 rounded-lg px-3 py-1.5"
                >
                  <Text className="text-white text-sm font-medium">Claim</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/hooks/useEvents.ts apps/mobile/app/\(tabs\)/events/ apps/mobile/__tests__/hooks/useEvents.test.ts
git commit -m "feat: P2-09 events hooks + screens — list, detail, RSVP, claim items"
```

---

## Task 8: Calendar hooks + screens

**Files:**
- Create: `apps/mobile/hooks/useCalendar.ts`
- Create: `apps/mobile/app/(tabs)/calendar/index.tsx`
- Create: `apps/mobile/app/(tabs)/calendar/[date].tsx`
- Create: `apps/mobile/__tests__/hooks/useCalendar.test.ts`

### API reference
- `GET /api/v1/families/:familyId/calendar?month=YYYY-MM` → `{ month: "YYYY-MM", events: CalendarRow[] }`
- `GET /api/v1/families/:familyId/calendar/upcoming?days=1` — used for day view (filter client-side from monthly data)

### CalendarRow shape (SerializedDbEvent | SyntheticBirthdayEvent):
```ts
{ id, title, startAt, endAt, isBirthdayEvent, birthdayPersonId, familyGroupId, ... }
```

- [ ] **Step 1: Write failing tests**

Create `apps/mobile/__tests__/hooks/useCalendar.test.ts`:
```ts
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { ReactNode } from "react";
import { useCalendarMonth } from "../../hooks/useCalendar";

jest.mock("../../lib/api", () => ({ useApiFetch: jest.fn() }));
import { useApiFetch } from "../../lib/api";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useCalendarMonth", () => {
  it("fetches calendar data for the given month", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      month: "2026-05",
      events: [{ id: "e1", title: "Family Dinner", startAt: "2026-05-10T18:00:00.000Z", isBirthdayEvent: false }]
    });
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useCalendarMonth("fam1", 2026, 5), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/v1/families/fam1/calendar?month=2026-05");
    expect(result.current.data?.events[0].title).toBe("Family Dinner");
  });

  it("is disabled when familyId is null", () => {
    const mockFetch = jest.fn();
    (useApiFetch as jest.Mock).mockReturnValue(mockFetch);
    const { result } = renderHook(() => useCalendarMonth(null, 2026, 5), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd apps/mobile && npm test -- --testPathPattern="__tests__/hooks/useCalendar"
```

Expected: FAIL — `Cannot find module '../../hooks/useCalendar'`

- [ ] **Step 3: Create hooks/useCalendar.ts**

Create `apps/mobile/hooks/useCalendar.ts`:
```ts
import { useQuery } from "@tanstack/react-query";
import { useApiFetch } from "../lib/api";

export interface CalendarEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  isBirthdayEvent: boolean;
  birthdayPersonId: string | null;
  familyGroupId: string;
  description?: string | null;
  locationName?: string | null;
}

export function useCalendarMonth(familyId: string | null, year: number, month: number) {
  const apiFetch = useApiFetch();
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  return useQuery({
    queryKey: ["calendar", familyId, monthStr],
    queryFn: () =>
      apiFetch<{ month: string; events: CalendarEvent[] }>(
        `/api/v1/families/${familyId}/calendar?month=${monthStr}`
      ),
    enabled: familyId !== null,
  });
}

export function eventsOnDate(events: CalendarEvent[], date: string): CalendarEvent[] {
  const target = date.slice(0, 10);
  return events.filter((e) => e.startAt.slice(0, 10) === target);
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cd apps/mobile && npm test -- --testPathPattern="__tests__/hooks/useCalendar"
```

Expected: PASS — 2 tests

- [ ] **Step 5: Create calendar/index.tsx**

Create `apps/mobile/app/(tabs)/calendar/index.tsx`:
```tsx
import { useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useMyFamilies } from "../../../hooks/useFamily";
import { useCalendarMonth, eventsOnDate } from "../../../hooks/useCalendar";
import type { ReactElement } from "react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function CalendarIndex(): ReactElement {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const familiesQuery = useMyFamilies();
  const familyId = familiesQuery.data?.memberships[0]?.familyGroup.id ?? null;
  const calendarQuery = useCalendarMonth(familyId, year, month);

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = Array.from({ length: firstDay + daysInMonth }, (_, i) =>
    i < firstDay ? null : i - firstDay + 1
  );
  const events = calendarQuery.data?.events ?? [];

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 16 }}>
      {/* Month nav */}
      <View className="flex-row items-center justify-between mb-6">
        <TouchableOpacity onPress={prevMonth} className="p-2">
          <Text className="text-slate-400 text-xl">‹</Text>
        </TouchableOpacity>
        <Text className="text-slate-50 font-semibold text-lg">{MONTHS[month - 1]} {year}</Text>
        <TouchableOpacity onPress={nextMonth} className="p-2">
          <Text className="text-slate-400 text-xl">›</Text>
        </TouchableOpacity>
      </View>

      {/* Day headers */}
      <View className="flex-row mb-2">
        {DAYS.map(d => (
          <View key={d} className="flex-1 items-center">
            <Text className="text-slate-500 text-xs">{d}</Text>
          </View>
        ))}
      </View>

      {/* Grid */}
      {calendarQuery.isLoading ? (
        <View className="py-12 items-center"><ActivityIndicator color="#6366f1" /></View>
      ) : (
        <View className="flex-row flex-wrap">
          {cells.map((day, i) => {
            if (day === null) {
              return <View key={`empty-${i}`} style={{ width: "14.28%" }} className="aspect-square" />;
            }
            const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const dayEvents = eventsOnDate(events, dateStr);
            const hasBirthday = dayEvents.some(e => e.isBirthdayEvent);
            const hasEvent = dayEvents.some(e => !e.isBirthdayEvent);
            const isToday = dateStr === now.toISOString().slice(0, 10);
            return (
              <TouchableOpacity
                key={dateStr}
                onPress={() => router.push(`/(tabs)/calendar/${dateStr}`)}
                style={{ width: "14.28%" }}
                className="aspect-square items-center justify-center"
              >
                <View className={`w-8 h-8 rounded-full items-center justify-center ${isToday ? "bg-indigo-600" : ""}`}>
                  <Text className={`text-sm ${isToday ? "text-white font-bold" : "text-slate-300"}`}>{day}</Text>
                </View>
                <View className="flex-row gap-0.5 mt-0.5">
                  {hasEvent && <View className="w-1.5 h-1.5 rounded-full bg-indigo-400" />}
                  {hasBirthday && <View className="w-1.5 h-1.5 rounded-full bg-yellow-400" />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
```

- [ ] **Step 6: Create calendar/[date].tsx**

Create `apps/mobile/app/(tabs)/calendar/[date].tsx`:
```tsx
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMyFamilies } from "../../../hooks/useFamily";
import { useCalendarMonth, eventsOnDate } from "../../../hooks/useCalendar";
import type { ReactElement } from "react";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function DayView(): ReactElement {
  const { date } = useLocalSearchParams<{ date: string }>();
  const router = useRouter();
  const [yearStr, monthStr] = date.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);

  const familiesQuery = useMyFamilies();
  const familyId = familiesQuery.data?.memberships[0]?.familyGroup.id ?? null;
  const calendarQuery = useCalendarMonth(familyId, year, month);

  const dayEvents = calendarQuery.data ? eventsOnDate(calendarQuery.data.events, date) : [];

  const displayDate = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  if (calendarQuery.isLoading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator color="#6366f1" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-950" contentContainerStyle={{ padding: 24 }}>
      <Text className="text-slate-400 text-sm mb-6">{displayDate}</Text>

      {dayEvents.length === 0 ? (
        <View className="items-center py-12">
          <Text className="text-slate-400">Nothing on this day</Text>
        </View>
      ) : (
        dayEvents.map((event) => (
          <TouchableOpacity
            key={event.id}
            onPress={() => !event.isBirthdayEvent && router.push(`/(tabs)/events/${event.id}`)}
            className="bg-slate-800 rounded-xl p-4 mb-3"
          >
            <View className="flex-row items-start gap-3">
              <Text className="text-xl">{event.isBirthdayEvent ? "🎂" : "📅"}</Text>
              <View className="flex-1">
                <Text className="text-slate-50 font-medium">{event.title}</Text>
                <Text className="text-slate-400 text-sm mt-1">{formatTime(event.startAt)}</Text>
                {event.locationName && (
                  <Text className="text-slate-500 text-sm mt-0.5">{event.locationName}</Text>
                )}
              </View>
            </View>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/hooks/useCalendar.ts apps/mobile/app/\(tabs\)/calendar/ apps/mobile/__tests__/hooks/useCalendar.test.ts
git commit -m "feat: P2-09 calendar hooks + screens — monthly grid and day view"
```

---

## Task 9: Assistant screen

**Files:**
- Create: `apps/mobile/app/(tabs)/assistant/index.tsx`

### How the AI chat works on mobile
The Express API at `POST /api/v1/ai/chat` accepts:
```json
{ "messages": [{ "role": "user", "content": "text" }], "familyGroupId": "...", "conversationId": "..." }
```
It returns a streaming AI SDK data-stream response. On mobile, use `@ai-sdk/react` `useChat` with a custom transport that:
1. Injects the Bearer token dynamically using `useAuth().getToken()`
2. Converts the `UIMessage[]` format to the Express body format
3. Points at `${API_BASE}/api/v1/ai/chat`

- [ ] **Step 1: Create assistant/index.tsx**

Create `apps/mobile/app/(tabs)/assistant/index.tsx`:
```tsx
import { useRef, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  KeyboardAvoidingView, Platform, ActivityIndicator
} from "react-native";
import { useAuth } from "@clerk/clerk-expo";
import { useChat } from "@ai-sdk/react";
import { useMyFamilies } from "../../../hooks/useFamily";
import { API_BASE } from "../../../lib/config";
import type { ReactElement } from "react";
import { useState } from "react";

export default function AssistantScreen(): ReactElement {
  const { getToken } = useAuth();
  const familiesQuery = useMyFamilies();
  const familyId = familiesQuery.data?.memberships[0]?.familyGroup.id ?? null;
  const [inputText, setInputText] = useState("");
  const listRef = useRef<FlatList>(null);

  const { messages, status, sendMessage } = useChat({
    transport: {
      async sendMessage(chatRequest) {
        const token = await getToken();
        const lastMsg = chatRequest.messages[chatRequest.messages.length - 1];
        const text = (lastMsg?.parts ?? [])
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("");

        return fetch(`${API_BASE}/api/v1/ai/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token ?? ""}`,
          },
          body: JSON.stringify({
            messages: [{ role: "user", content: text }],
            familyGroupId: familyId,
            conversationId: chatRequest.id,
          }),
        });
      },
      reconnect() {
        return null;
      },
    },
  });

  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    if (messages.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages]);

  function handleSend() {
    if (!inputText.trim() || !familyId || isStreaming) return;
    void sendMessage({ text: inputText.trim() }, { body: { familyGroupId: familyId } });
    setInputText("");
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-950"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center py-12">
            <Text className="text-slate-400 text-center">Ask about your family — events, birthdays, who's coming…</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isUser = item.role === "user";
          const textContent = (item.parts ?? [])
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join("");

          return (
            <View className={`mb-3 flex-row ${isUser ? "justify-end" : "justify-start"}`}>
              <View
                className={`rounded-2xl px-4 py-3 max-w-[80%] ${
                  isUser ? "bg-indigo-600" : "bg-slate-800"
                }`}
              >
                <Text className={isUser ? "text-white" : "text-slate-50"}>{textContent}</Text>
              </View>
            </View>
          );
        }}
      />

      {isStreaming && (
        <View className="px-4 pb-2 flex-row items-center gap-2">
          <ActivityIndicator size="small" color="#6366f1" />
          <Text className="text-slate-400 text-sm">Thinking…</Text>
        </View>
      )}

      <View className="flex-row items-center gap-3 px-4 py-3 border-t border-slate-800">
        <TextInput
          className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-slate-50"
          value={inputText}
          onChangeText={setInputText}
          placeholder="Ask about your family…"
          placeholderTextColor="#64748b"
          multiline
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
          onPress={handleSend}
          disabled={!inputText.trim() || isStreaming || !familyId}
          className="bg-indigo-600 rounded-xl p-3 disabled:opacity-50"
        >
          <Text className="text-white font-semibold">↑</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
```

- [ ] **Step 2: Run all tests to confirm nothing regressed**

```bash
cd apps/mobile && npm test
```

Expected: all previously written tests PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/\(tabs\)/assistant/
git commit -m "feat: P2-09 AI assistant screen — streaming chat with Clerk auth"
```

---

## Task 10: Final pass — run tests + commit

- [ ] **Step 1: Run full test suite with coverage**

```bash
cd apps/mobile && npm run test:coverage
```

Expected: all tests pass, coverage ≥ 80% on lib/ and hooks/.

- [ ] **Step 2: Type-check**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 3: Final commit**

```bash
git add apps/mobile/
git commit -m "feat: P2-09 mobile core screens — auth, family, events, calendar, assistant"
```

---

## Open Questions (from spec)

| # | Question | Owner | Needed before |
|---|---|---|---|
| OQ-1 | Family tab card — what secondary label per person? (household, scope, role, or none) | Steve | Family `index.tsx` — currently renders no secondary label |
