"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../../../components/ui/button";
import { Card, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { apiFetch } from "../../../lib/api";
import { fetchSubscription, getSeatImpact, createCheckoutSession } from "../../../lib/api/billing";
import type { SeatImpact } from "../../../lib/api/billing";
import { SeatExpansionModal } from "../../../components/billing/SeatExpansionModal";

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
  const [seatModal, setSeatModal] = useState<{ tierKey: string; impact: SeatImpact } | null>(null);

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
            ageGateLevel: "ADULT"
          })
        });
        const base = process.env.NEXT_PUBLIC_API_URL ?? "";
        const memberUrl = `${base.replace(/\/$/, "")}/api/v1/families/${encodeURIComponent(familyGroupId)}/members`;
        const token = await getToken();
        const memberHeaders = new Headers({ "Content-Type": "application/json" });
        if (token) memberHeaders.set("Authorization", `Bearer ${token}`);
        const memberRes = await fetch(memberUrl, {
          method: "POST",
          headers: memberHeaders,
          body: JSON.stringify({ personId: created.id, roles: ["MEMBER"], permissions: [] }),
          cache: "no-store"
        });

        if (memberRes.status === 402) {
          const sub = await fetchSubscription(getToken);
          if (sub) {
            const impact = await getSeatImpact(getToken, sub.seatCount + 1);
            setSeatModal({ tierKey: sub.tierKey, impact });
          } else {
            setError("Seat limit reached. Please upgrade your plan.");
          }
          return;  // stop the loop
        }

        if (!memberRes.ok) {
          const body = await memberRes.json().catch(() => ({}));
          throw new Error((body as any).error ?? `API ${memberRes.status}: failed`);
        }
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

  async function handleSeatConfirm(): Promise<void> {
    if (!seatModal) return;
    const successUrl = `${window.location.origin}/billing/success`;
    const cancelUrl = `${window.location.origin}/billing/plans`;
    try {
      const url = await createCheckoutSession(getToken, seatModal.tierKey, seatModal.impact.newSeats, successUrl, cancelUrl);
      window.location.href = url;
    } catch {
      setError("Failed to start checkout. Please try again.");
      setSeatModal(null);
    }
  }

  function handleSeatCancel(): void {
    setSeatModal(null);
    setLoading(false);
  }

  if (seatModal) {
    return (
      <SeatExpansionModal
        currentSeats={seatModal.impact.currentSeats}
        newSeats={seatModal.impact.newSeats}
        immediateCharge={seatModal.impact.immediateCharge}
        recurringIncrease={seatModal.impact.recurringIncrease}
        currency={seatModal.impact.currency}
        onConfirm={() => void handleSeatConfirm()}
        onCancel={handleSeatCancel}
      />
    );
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
