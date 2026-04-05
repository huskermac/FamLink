"use client";

import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Card, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { apiFetch } from "../../../lib/api";

export type ProfileForm = {
  firstName: string;
  lastName: string;
  preferredName: string;
  dateOfBirth: string;
};

type ProfileStepProps = {
  getToken: () => Promise<string | null>;
  personId: string | null;
  initial: ProfileForm;
  onDone: (personId: string) => void;
};

export function ProfileStep(props: ProfileStepProps): ReactElement {
  const { getToken, personId, initial, onDone } = props;
  const [form, setForm] = useState<ProfileForm>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setForm(initial);
  }, [
    initial.firstName,
    initial.lastName,
    initial.preferredName,
    initial.dateOfBirth
  ]);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError("First and last name are required.");
      return;
    }
    setLoading(true);
    try {
      const body = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        preferredName: form.preferredName.trim() || undefined,
        dateOfBirth: form.dateOfBirth.trim() || undefined,
        ageGateLevel: "NONE" as const
      };
      if (personId) {
        await apiFetch<{ id: string }>(`/api/v1/persons/${personId}`, {
          getToken,
          method: "PUT",
          body: JSON.stringify(body)
        });
        onDone(personId);
      } else {
        const created = await apiFetch<{ id: string }>("/api/v1/persons", {
          getToken,
          method: "POST",
          body: JSON.stringify(body)
        });
        onDone(created.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardTitle className="mb-1">Your profile</CardTitle>
      <p className="mb-4 text-sm text-slate-400">Tell us how to address you in FamLink.</p>
      <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <div className="space-y-2">
          <Label htmlFor="firstName">First name</Label>
          <Input
            id="firstName"
            value={form.firstName}
            onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            autoComplete="given-name"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input
            id="lastName"
            value={form.lastName}
            onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
            autoComplete="family-name"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="preferredName">Preferred name (optional)</Label>
          <Input
            id="preferredName"
            value={form.preferredName}
            onChange={(e) => setForm((f) => ({ ...f, preferredName: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dob">Date of birth (optional)</Label>
          <Input
            id="dob"
            type="date"
            value={form.dateOfBirth}
            onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
          />
        </div>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <Button type="submit" disabled={loading}>
          {loading ? "Saving…" : "Continue"}
        </Button>
      </form>
    </Card>
  );
}
