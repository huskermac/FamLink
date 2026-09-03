"use client";
import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getHousehold, getHouseholdAudit, unlinkHousehold } from "@/lib/api/family";

interface Props {
  householdId: string;
  familyId: string;
  isAdmin: boolean;
}

export function HouseholdSection({ householdId, familyId, isAdmin }: Props) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [confirmDestroy, setConfirmDestroy] = useState(false);

  const { data: household } = useQuery({
    queryKey: ["household", householdId],
    queryFn: () => getHousehold(householdId, getToken)
  });
  // The audit endpoint is admin-only; do not fire it for a non-admin (avoids a silent 403).
  const { data: audit } = useQuery({
    queryKey: ["household-audit", householdId],
    queryFn: () => getHouseholdAudit(householdId, getToken),
    enabled: isAdmin
  });

  const unlink = useMutation({
    mutationFn: (destroy: boolean) =>
      unlinkHousehold(householdId, { familyGroupId: familyId, ...(destroy ? { destroy: true } : {}) }, getToken),
    onSuccess: () => {
      setConfirmDestroy(false);
      queryClient.invalidateQueries({ queryKey: ["family", familyId] });
    },
    onError: (err: unknown) => {
      if (err instanceof Error && err.message.includes("LAST_LINK")) setConfirmDestroy(true);
    }
  });

  const linkedFamilies = household?.linkedFamilies ?? [];
  const entries = audit?.entries ?? [];

  return (
    <section style={{ marginTop: "24px", maxWidth: "480px" }}>
      <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "8px" }}>
        Household {household?.name ? `· ${household.name}` : ""}
      </div>

      <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px" }}>Linked families</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "16px" }}>
        {linkedFamilies.map((f, i) => (
          <div key={i} style={{ fontSize: "14px", color: "var(--text-primary)" }}>{f.name}</div>
        ))}
      </div>

      {isAdmin && (
        <>
          <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px" }}>Activity</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "16px" }}>
            {entries.map((e) => (
              <div key={e.id} style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                {e.actorDisplayName} · {e.action} · {new Date(e.createdAt).toLocaleDateString("en-US")}
              </div>
            ))}
          </div>

          {!confirmDestroy && (
            <button
              onClick={() => unlink.mutate(false)}
              disabled={unlink.isPending}
              style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-secondary)", fontSize: "13px", cursor: "pointer" }}
            >
              Unlink this family
            </button>
          )}

          {confirmDestroy && (
            <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
              <p style={{ marginBottom: "8px" }}>This is the last linked family. Unlinking deletes the household.</p>
              <button
                onClick={() => unlink.mutate(true)}
                disabled={unlink.isPending}
                style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: "#dc2626", color: "#fff", fontSize: "13px", cursor: "pointer" }}
              >
                Delete the household
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
