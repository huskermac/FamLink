"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { Card, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { apiFetch } from "../../../lib/api";

type FamilyStepProps = {
  getToken: () => Promise<string | null>;
  onDone: (familyGroupId: string) => void;
};

export function FamilyStep(props: FamilyStepProps): ReactElement {
  const { getToken, onDone } = props;
  const [familyName, setFamilyName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const name = familyName.trim();
    if (name.length < 2) {
      setError("Family name must be at least 2 characters.");
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch<{ familyGroup: { id: string } }>("/api/v1/families", {
        getToken,
        method: "POST",
        body: JSON.stringify({ name })
      });
      onDone(res.familyGroup.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create family.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardTitle className="mb-1">Create your family</CardTitle>
      <p className="mb-4 text-sm text-slate-400">
        This is the name your family will see when they join.
      </p>
      <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <div className="space-y-2">
          <Label htmlFor="familyName">Family name</Label>
          <Input
            id="familyName"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            placeholder='e.g. "The Johnson Family"'
            required
            minLength={2}
          />
        </div>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <Button type="submit" disabled={loading}>
          {loading ? "Creating…" : "Continue"}
        </Button>
      </form>
    </Card>
  );
}
