"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { Card, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { apiFetch } from "../../../lib/api";

type HouseholdStepProps = {
  getToken: () => Promise<string | null>;
  familyGroupId: string;
  onDone: () => void;
};

export function HouseholdStep(props: HouseholdStepProps): ReactElement {
  const { getToken, familyGroupId, onDone } = props;
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const n = name.trim();
    if (!n) {
      setError("Household name is required.");
      return;
    }
    setLoading(true);
    try {
      await apiFetch(`/api/v1/families/${encodeURIComponent(familyGroupId)}/households`, {
        getToken,
        method: "POST",
        body: JSON.stringify({
          name: n,
          city: city.trim() || undefined,
          state: state.trim() || undefined
        })
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create household.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardTitle className="mb-1">Your household</CardTitle>
      <p className="mb-4 text-sm text-slate-400">A home base for calendars and events.</p>
      <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <div className="space-y-2">
          <Label htmlFor="householdName">Household name</Label>
          <Input
            id="householdName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={'e.g. "Sarah & Tom\'s House"'}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="city">City (optional)</Label>
          <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="state">State (optional)</Label>
          <Input id="state" value={state} onChange={(e) => setState(e.target.value)} />
        </div>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <Button type="submit" disabled={loading}>
          {loading ? "Saving…" : "Continue"}
        </Button>
      </form>
    </Card>
  );
}
