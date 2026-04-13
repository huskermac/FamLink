import type { PersonBrief } from "@/lib/api/family";

interface Props {
  person: PersonBrief;
}

function displayName(p: PersonBrief): string {
  return p.preferredName ?? `${p.firstName} ${p.lastName}`;
}

function initials(p: PersonBrief): string {
  const first = (p.preferredName ?? p.firstName).charAt(0).toUpperCase();
  const last = p.lastName.charAt(0).toUpperCase();
  return `${first}${last}`;
}

export function PersonHeader({ person }: Props) {
  const isMinor = person.ageGateLevel === "MINOR";

  return (
    <div className="flex items-center gap-4">
      {person.profilePhotoUrl ? (
        <img
          src={person.profilePhotoUrl}
          alt={displayName(person)}
          className="h-16 w-16 rounded-full object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-600 text-xl font-semibold text-slate-200"
        >
          {initials(person)}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-slate-100">{displayName(person)}</h1>
        {isMinor && (
          <span className="inline-flex w-fit items-center rounded-full bg-amber-900/40 px-2.5 py-0.5 text-xs font-medium text-amber-300 ring-1 ring-amber-700/50">
            Minor
          </span>
        )}
      </div>
    </div>
  );
}
