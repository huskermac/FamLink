"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { getPerson } from "@/lib/api/family";
import { PersonHeader } from "@/components/family/PersonHeader";
import { ProfilePhotoUploadButton } from "@/components/photos/ProfilePhotoUploadButton";

export default function PersonProfilePage() {
  const { familyId, personId } = useParams<{ familyId: string; personId: string }>();
  const { getToken } = useAuth();

  const { data: person, isLoading, isError } = useQuery({
    queryKey: ["person", personId],
    queryFn: () => getPerson(personId, getToken),
    enabled: Boolean(personId),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 animate-pulse rounded-full" style={{ background: "var(--border)" }} />
          <div className="h-6 w-40 animate-pulse rounded" style={{ background: "var(--border)" }} />
        </div>
      </div>
    );
  }

  if (isError || !person) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-400">Failed to load person details. Please try again.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "12px" }}>
        <div className="flex items-end gap-4">
          <PersonHeader person={person} />
          <ProfilePhotoUploadButton personId={personId} />
        </div>
        <Link
          href={`/family/${familyId}/members/${personId}/edit`}
          className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
          style={{ border: "1px solid var(--border)", color: "var(--text-secondary)", background: "transparent", whiteSpace: "nowrap" }}
        >
          Edit
        </Link>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
          Contact Info
        </h2>
        <div className="rounded-lg p-4" style={{ border: "1px solid var(--border)", background: "var(--bg-card)" }}>
          {person.dateOfBirth ? (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              <span className="font-medium" style={{ color: "var(--text-muted)" }}>Date of birth: </span>
              {new Date(person.dateOfBirth).toLocaleDateString("en-US", { timeZone: "UTC" })}
            </p>
          ) : (
            <p className="text-sm italic" style={{ color: "var(--text-muted)" }}>No contact info on file.</p>
          )}
        </div>
      </section>
    </div>
  );
}
