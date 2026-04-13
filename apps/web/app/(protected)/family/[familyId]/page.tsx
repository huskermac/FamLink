"use client";

import { useParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { getFamilyDetails } from "@/lib/api/family";
import { MemberGrid } from "@/components/family/MemberGrid";
import { HouseholdList } from "@/components/family/HouseholdList";

function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-lg border border-slate-700 bg-slate-800/40" />
      ))}
    </div>
  );
}

export default function FamilyDetailPage() {
  const { familyId } = useParams<{ familyId: string }>();
  const { getToken } = useAuth();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["family", familyId],
    queryFn: () => getFamilyDetails(familyId, getToken),
    enabled: Boolean(familyId),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-8 p-6">
        <div className="h-7 w-48 animate-pulse rounded bg-slate-700" />
        <SectionSkeleton />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-400">Failed to load family details. Please try again.</p>
      </div>
    );
  }

  const { familyGroup, members, households } = data;
  const allMembers = members.map((m) => m.person);

  return (
    <div className="flex flex-col gap-8 p-6">
      <h1 className="text-2xl font-semibold text-slate-100">{familyGroup.name}</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Members</h2>
        <MemberGrid members={allMembers} familyId={familyId} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Households</h2>
        <HouseholdList households={households} familyId={familyId} />
      </section>
    </div>
  );
}
