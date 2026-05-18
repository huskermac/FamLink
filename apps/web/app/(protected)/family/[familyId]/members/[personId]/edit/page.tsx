"use client";

import { useState, use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPerson, updatePerson } from "@/lib/api/family";

type Params = { familyId: string; personId: string };

function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

export default function EditPersonPage({ params }: { params: Promise<Params> }) {
  const { familyId, personId } = use(params);
  const router = useRouter();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const { data: person, isLoading, isError } = useQuery({
    queryKey: ["person", personId],
    queryFn: () => getPerson(personId, getToken),
    enabled: Boolean(personId),
  });

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (person && !initialized) {
      setFirstName(person.firstName);
      setLastName(person.lastName);
      setPreferredName(person.preferredName ?? "");
      setDateOfBirth(person.dateOfBirth ? toDateInput(person.dateOfBirth) : "");
      setInitialized(true);
    }
  }, [person, initialized]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!firstName.trim()) {
      setError("First name is required.");
      return;
    }
    if (!lastName.trim()) {
      setError("Last name is required.");
      return;
    }

    setSubmitting(true);
    try {
      await updatePerson(
        personId,
        {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          ...(preferredName.trim() ? { preferredName: preferredName.trim() } : {}),
          ...(dateOfBirth ? { dateOfBirth } : {}),
        },
        getToken
      );
      await queryClient.invalidateQueries({ queryKey: ["person", personId] });
      router.push(`/family/${familyId}/members/${personId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes.");
      setSubmitting(false);
    }
  }

  const inputStyle = {
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "var(--bg-card)",
    padding: "8px 12px",
    fontSize: "14px",
    color: "var(--text-primary)",
    width: "100%",
    outline: "none",
  };

  const labelStyle = {
    fontSize: "13px",
    fontWeight: 500 as const,
    color: "var(--text-secondary)",
  };

  if (isLoading || !initialized) {
    return (
      <div className="flex flex-col gap-4 p-6 max-w-lg">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded" style={{ background: "var(--border)" }} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-400">Failed to load person. Please try again.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-lg">
      <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Edit Profile</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">

        <div className="flex flex-col gap-1">
          <label htmlFor="firstName" style={labelStyle}>
            First name <span className="text-red-400">*</span>
          </label>
          <input
            id="firstName"
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="lastName" style={labelStyle}>
            Last name <span className="text-red-400">*</span>
          </label>
          <input
            id="lastName"
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="preferredName" style={labelStyle}>
            Preferred name <span style={{ color: "var(--text-muted)" }}>(optional)</span>
          </label>
          <input
            id="preferredName"
            type="text"
            value={preferredName}
            onChange={(e) => setPreferredName(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="dateOfBirth" style={labelStyle}>
            Date of birth <span style={{ color: "var(--text-muted)" }}>(optional)</span>
          </label>
          <input
            id="dateOfBirth"
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            style={inputStyle}
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {submitting ? "Saving…" : "Save Changes"}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/family/${familyId}/members/${personId}`)}
            className="rounded-md px-4 py-2 text-sm font-medium transition-colors"
            style={{ border: "1px solid var(--border)", color: "var(--text-secondary)", background: "transparent" }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
