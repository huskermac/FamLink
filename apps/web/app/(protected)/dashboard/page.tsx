import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { apiFetch } from "@/lib/api";

type MeResponse = {
  id: string;
  firstName: string;
  lastName: string;
};

type FamilyMembership = {
  familyGroup: {
    id: string;
    name: string;
  };
};

type UpcomingResponse = {
  events: unknown[];
};

export default async function DashboardPage(): Promise<ReactElement> {
  const { userId, getToken } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  let me: MeResponse;
  try {
    me = await apiFetch<MeResponse>("/api/v1/persons/me", {
      getToken,
      method: "GET"
    });
  } catch {
    redirect("/onboarding");
  }

  let families: FamilyMembership[];
  try {
    families = await apiFetch<FamilyMembership[]>("/api/v1/persons/me/families", {
      getToken,
      method: "GET"
    });
  } catch {
    redirect("/onboarding");
  }

  if (families.length === 0) {
    redirect("/onboarding");
  }

  const primaryFamily = families[0].familyGroup;
  let upcomingCount = 0;
  try {
    const upcoming = await apiFetch<UpcomingResponse>(
      `/api/v1/families/${encodeURIComponent(primaryFamily.id)}/calendar/upcoming?days=365`,
      { getToken, method: "GET" }
    );
    upcomingCount = Array.isArray(upcoming.events) ? upcoming.events.length : 0;
  } catch {
    upcomingCount = 0;
  }

  return (
    <div className="px-4 py-10" style={{ color: "var(--text-primary)" }}>
      <div className="mx-auto w-full max-w-lg space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome, {me.firstName}!
        </h1>
        <p style={{ color: "var(--text-secondary)" }}>
          You&apos;re in <span style={{ color: "var(--text-primary)" }}>{primaryFamily.name}</span>. Upcoming
          events in the next 30 days:{" "}
          <span className="font-medium" style={{ color: "var(--text-primary)" }}>{upcomingCount}</span>
        </p>
        <nav
          className="flex flex-col gap-3 rounded-lg p-4"
          style={{ border: "1px solid var(--border)", background: "var(--bg-card)" }}
        >
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>Quick links</p>
          <ul className="space-y-2 text-sm">
            <li>
              <Link href="/dashboard" style={{ color: "var(--accent)" }}>
                Create event
              </Link>
              <span className="ml-2" style={{ color: "var(--text-muted)" }}>(Phase 2)</span>
            </li>
            <li>
              <Link href="/dashboard" style={{ color: "var(--accent)" }}>
                View calendar
              </Link>
              <span className="ml-2" style={{ color: "var(--text-muted)" }}>(Phase 2)</span>
            </li>
            <li>
              <Link href="/onboarding" style={{ color: "var(--accent)" }}>
                Invite members
              </Link>
              <span className="ml-2" style={{ color: "var(--text-muted)" }}>(onboarding flow)</span>
            </li>
          </ul>
        </nav>
      </div>
    </div>
  );
}
