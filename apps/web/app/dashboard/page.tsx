import type { ReactElement } from "react";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { apiFetch } from "../../lib/api";

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
      `/api/v1/families/${encodeURIComponent(primaryFamily.id)}/calendar/upcoming?days=30`,
      { getToken, method: "GET" }
    );
    upcomingCount = Array.isArray(upcoming.events) ? upcoming.events.length : 0;
  } catch {
    upcomingCount = 0;
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto w-full max-w-lg space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome, {me.firstName}!
        </h1>
        <p className="text-slate-400">
          You&apos;re in <span className="text-slate-200">{primaryFamily.name}</span>. Upcoming
          events in the next 30 days:{" "}
          <span className="font-medium text-slate-200">{upcomingCount}</span>
        </p>
        <nav className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-4">
          <p className="text-sm font-medium text-slate-300">Quick links</p>
          <ul className="space-y-2 text-sm">
            <li>
              <Link href="/dashboard" className="text-sky-400 underline hover:text-sky-300">
                Create event
              </Link>
              <span className="ml-2 text-slate-500">(Phase 2)</span>
            </li>
            <li>
              <Link href="/dashboard" className="text-sky-400 underline hover:text-sky-300">
                View calendar
              </Link>
              <span className="ml-2 text-slate-500">(Phase 2)</span>
            </li>
            <li>
              <Link href="/onboarding" className="text-sky-400 underline hover:text-sky-300">
                Invite members
              </Link>
              <span className="ml-2 text-slate-500">(onboarding flow)</span>
            </li>
          </ul>
        </nav>
      </div>
    </main>
  );
}
