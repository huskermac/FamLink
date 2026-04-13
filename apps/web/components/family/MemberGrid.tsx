import type { PersonBrief } from "@/lib/api/family";
import { MemberCard } from "./MemberCard";

interface Props {
  members: PersonBrief[];
  familyId: string;
}

export function MemberGrid({ members, familyId }: Props) {
  if (members.length === 0) {
    return <p className="text-sm text-slate-400">No members yet</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {members.map((p) => (
        <MemberCard key={p.id} person={p} familyId={familyId} />
      ))}
    </div>
  );
}
