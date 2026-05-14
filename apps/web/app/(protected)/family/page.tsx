"use client";

import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { getMyFamilies } from "@/lib/api/family";
import type { FamilyMembership } from "@/lib/api/family";

function FamilyCard({ membership }: { membership: FamilyMembership }) {
  const { familyGroup, role } = membership;
  return (
    <Link
      href={`/family/${familyGroup.id}`}
      className="flex flex-col gap-1 rounded-lg p-4 transition-colors"
      style={{ border: "1px solid var(--border)", background: "var(--bg-card)", textDecoration: "none" }}
    >
      <span className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>{familyGroup.name}</span>
      <span className="text-xs capitalize" style={{ color: "var(--text-secondary)" }}>{role.toLowerCase()}</span>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div className="h-16 animate-pulse rounded-lg" style={{ border: "1px solid var(--border)", background: "var(--bg-card)" }} />
  );
}

export default function FamilyDashboardPage() {
  const { getToken } = useAuth();
  const { data: memberships, isLoading, isError } = useQuery({
    queryKey: ["families"],
    queryFn: () => getMyFamilies(getToken),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Your Families</h1>
        <div className="flex flex-col gap-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (isError || !memberships) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Your Families</h1>
        <p className="mt-4 text-sm text-red-400">Failed to load families. Please try again.</p>
      </div>
    );
  }

  if (memberships.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Your Families</h1>
        <p className="mt-4 text-sm" style={{ color: "var(--text-secondary)" }}>You haven&apos;t joined a family yet.</p>
        <Link
          href="/onboarding"
          className="mt-3 inline-block text-sm"
          style={{ color: "var(--accent)" }}
        >
          Get started with onboarding →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Your Families</h1>
      <div className="flex flex-col gap-3">
        {memberships.map((m) => (
          <FamilyCard key={m.familyGroup.id} membership={m} />
        ))}
      </div>
    </div>
  );
}
