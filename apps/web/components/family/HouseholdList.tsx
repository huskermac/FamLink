"use client";

import { useState } from "react";
import type { HouseholdWithMembers } from "@/lib/api/family";
import { MemberCard } from "./MemberCard";

interface Props {
  households: HouseholdWithMembers[];
  familyId: string;
}

function HouseholdRow({
  entry,
  familyId
}: {
  entry: HouseholdWithMembers;
  familyId: string;
}) {
  const [open, setOpen] = useState(false);
  const { household, members } = entry;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-slate-100">{household.name}</span>
        <span className="text-xs text-slate-400">
          {members.length} {members.length === 1 ? "member" : "members"}{" "}
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-4 pb-3">
          {members.map((p) => (
            <MemberCard key={p.id} person={p} familyId={familyId} />
          ))}
        </div>
      )}
    </div>
  );
}

export function HouseholdList({ households, familyId }: Props) {
  if (households.length === 0) {
    return <p className="text-sm text-slate-400">No households yet</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {households.map((entry) => (
        <HouseholdRow key={entry.household.id} entry={entry} familyId={familyId} />
      ))}
    </div>
  );
}
