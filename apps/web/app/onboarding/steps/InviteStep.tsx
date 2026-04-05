"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../../../components/ui/button";
import { Card, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { apiFetch } from "../../../lib/api";

export type InviteeRow = {
  firstName: string;
  email: string;
  phone: string;
};

type InviteStepProps = {
  getToken: () => Promise<string | null>;
  familyGroupId: string;
};

const emptyRow = (): InviteeRow => ({ firstName: "", email: "", phone: "" });

export function InviteStep(props: InviteStepProps): ReactElement {
  const { getToken, familyGroupId } = props;
  const router = useRouter();
  const [rows, setRows] = useState<InviteeRow[]>([emptyRow()]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function updateRow(i: number, patch: Partial<InviteeRow>): void {
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  }

  function addRow(): void {
    if (rows.length >= 10) {
      return;
    }
    setRows((r) => [...r, emptyRow()]);
  }

  function removeRow(i: number): void {
    setRows((r) => (r.length <= 1 ? [emptyRow()] : r.filter((_, j) => j !== i)));
  }

  function validate(): string | null {
    for (const row of rows) {
      const hasAny = row.firstName.trim() || row.email.trim() || row.phone.trim();
      if (!hasAny) {
        continue;
      }
      if (!row.firstName.trim()) {
        return "First name is required for each person you add.";
      }
      if (!row.email.trim() && !row.phone.trim()) {
        return "Add an email or phone for each invitee (or remove the row).";
      }
    }
    return null;
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    const toInvite = rows.filter(
      (row) => row.firstName.trim() && (row.email.trim() || row.phone.trim())
    );
    if (toInvite.length === 0) {
      setError("Add at least one invitee, or use Skip.");
      return;
    }
    setLoading(true);
    try {
      for (const row of toInvite) {
        const created = await apiFetch<{ id: string }>("/api/v1/persons", {
          getToken,
          method: "POST",
          body: JSON.stringify({
            firstName: row.firstName.trim(),
            lastName: "Member",
            ageGateLevel: "NONE"
          })
        });
        await apiFetch(`/api/v1/families/${encodeURIComponent(familyGroupId)}/members`, {
          getToken,
          method: "POST",
          body: JSON.stringify({
            personId: created.id,
            roles: ["MEMBER"],
            permissions: []
          })
        });
      }
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed.");
    } finally {
      setLoading(false);
    }
  }

  function skip(): void {
    router.replace("/dashboard");
  }

  return (
    <Card>
      <CardTitle className="mb-1">Invite family members</CardTitle>
      <p className="mb-4 text-sm text-slate-400">
        Optional — add up to 10 people. Each needs a first name and an email or phone.
      </p>
      <form className="space-y-6" onSubmit={(e) => void onSubmit(e)}>
        {rows.map((row, i) => (
          <div key={i} className="space-y-3 rounded-md border border-slate-800 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">Person {i + 1}</span>
              {rows.length > 1 ? (
                <Button type="button" variant="outline" onClick={() => removeRow(i)}>
                  Remove
                </Button>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`fn-${i}`}>First name</Label>
              <Input
                id={`fn-${i}`}
                value={row.firstName}
                onChange={(e) => updateRow(i, { firstName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`em-${i}`}>Email (optional)</Label>
              <Input
                id={`em-${i}`}
                type="email"
                value={row.email}
                onChange={(e) => updateRow(i, { email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`ph-${i}`}>Phone (optional)</Label>
              <Input
                id={`ph-${i}`}
                type="tel"
                value={row.phone}
                onChange={(e) => updateRow(i, { phone: e.target.value })}
              />
            </div>
          </div>
        ))}
        {rows.length < 10 ? (
          <Button type="button" variant="outline" onClick={addRow}>
            Add another person
          </Button>
        ) : null}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button type="submit" disabled={loading}>
            {loading ? "Sending…" : "Finish & go to dashboard"}
          </Button>
          <Button type="button" variant="outline" disabled={loading} onClick={skip}>
            Skip for now
          </Button>
        </div>
      </form>
    </Card>
  );
}
