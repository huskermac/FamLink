"use client";

import { useParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { getPerson } from "@/lib/api/family";
import { PersonHeader } from "@/components/family/PersonHeader";

export default function PersonProfilePage() {
  const { personId } = useParams<{ personId: string }>();
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
          <div className="h-16 w-16 animate-pulse rounded-full bg-slate-700" />
          <div className="h-6 w-40 animate-pulse rounded bg-slate-700" />
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
      <PersonHeader person={person} />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
          Contact Info
        </h2>
        <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4">
          {person.dateOfBirth ? (
            <p className="text-sm text-slate-300">
              <span className="font-medium text-slate-400">Date of birth: </span>
              {new Date(person.dateOfBirth).toLocaleDateString()}
            </p>
          ) : (
            <p className="text-sm text-slate-500 italic">No contact info on file.</p>
          )}
        </div>
      </section>
    </div>
  );
}
