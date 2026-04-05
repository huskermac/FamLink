"use client";

import { useAuth } from "@clerk/nextjs";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { FamilyStep } from "./steps/FamilyStep";
import { HouseholdStep } from "./steps/HouseholdStep";
import { InviteStep } from "./steps/InviteStep";
import { ProfileStep, type ProfileForm } from "./steps/ProfileStep";

type MeResponse = {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  dateOfBirth: string | null;
};

export default function OnboardingPage(): ReactElement {
  const { isLoaded, userId, getToken } = useAuth();
  const router = useRouter();
  const [gate, setGate] = useState<"loading" | "ready">("loading");
  const [currentStep, setCurrentStep] = useState(1);
  const [personId, setPersonId] = useState<string | null>(null);
  const [profileInitial, setProfileInitial] = useState<ProfileForm>({
    firstName: "",
    lastName: "",
    preferredName: "",
    dateOfBirth: ""
  });
  const [familyGroupId, setFamilyGroupId] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !userId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const fam = await apiFetch<unknown[]>("/api/v1/persons/me/families", {
          getToken,
          method: "GET"
        });
        if (!cancelled && Array.isArray(fam) && fam.length > 0) {
          router.replace("/dashboard");
          return;
        }
      } catch {
        /* no person yet or empty — continue */
      }
      try {
        const me = await apiFetch<MeResponse>("/api/v1/persons/me", {
          getToken,
          method: "GET"
        });
        if (!cancelled) {
          setPersonId(me.id);
          setProfileInitial({
            firstName: me.firstName,
            lastName: me.lastName,
            preferredName: me.preferredName ?? "",
            dateOfBirth: me.dateOfBirth ?? ""
          });
        }
      } catch {
        if (!cancelled) {
          setPersonId(null);
          setProfileInitial({
            firstName: "",
            lastName: "",
            preferredName: "",
            dateOfBirth: ""
          });
        }
      } finally {
        if (!cancelled) {
          setGate("ready");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, userId, getToken, router]);

  if (!isLoaded) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <p className="text-slate-300">Loading…</p>
      </main>
    );
  }

  if (!userId) {
    router.replace("/sign-in");
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <p className="text-slate-300">Redirecting…</p>
      </main>
    );
  }

  if (gate === "loading") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <p className="text-slate-300">Preparing onboarding…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto w-full max-w-lg">
        <p className="mb-6 text-center text-sm text-slate-400">
          Step {currentStep} of 4 — Organizer setup
        </p>
        {currentStep === 1 ? (
          <ProfileStep
            getToken={getToken}
            personId={personId}
            initial={profileInitial}
            onDone={(id) => {
              setPersonId(id);
              setCurrentStep(2);
            }}
          />
        ) : null}
        {currentStep === 2 && personId ? (
          <FamilyStep
            getToken={getToken}
            onDone={(id) => {
              setFamilyGroupId(id);
              setCurrentStep(3);
            }}
          />
        ) : null}
        {currentStep === 3 && familyGroupId ? (
          <HouseholdStep
            getToken={getToken}
            familyGroupId={familyGroupId}
            onDone={() => setCurrentStep(4)}
          />
        ) : null}
        {currentStep === 4 && familyGroupId ? (
          <InviteStep getToken={getToken} familyGroupId={familyGroupId} />
        ) : null}
      </div>
    </main>
  );
}
