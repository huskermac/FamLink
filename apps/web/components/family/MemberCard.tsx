import Link from "next/link";
import type { PersonBrief } from "@/lib/api/family";

interface Props {
  person: PersonBrief;
  familyId: string;
}

function initials(p: PersonBrief): string {
  const first = (p.preferredName ?? p.firstName).charAt(0).toUpperCase();
  const last = p.lastName.charAt(0).toUpperCase();
  return `${first}${last}`;
}

function displayName(p: PersonBrief): string {
  return p.preferredName ?? `${p.firstName} ${p.lastName}`;
}

export function MemberCard({ person, familyId }: Props) {
  return (
    <Link
      href={`/family/${familyId}/members/${person.id}`}
      className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800/60 p-3 hover:bg-slate-800 transition-colors"
    >
      {person.profilePhotoUrl ? (
        <img
          src={person.profilePhotoUrl}
          alt={displayName(person)}
          className="h-10 w-10 rounded-full object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-600 text-sm font-semibold text-slate-200"
        >
          {initials(person)}
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-100">
          {displayName(person)}
        </p>
      </div>
    </Link>
  );
}
