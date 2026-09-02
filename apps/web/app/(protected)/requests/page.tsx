"use client";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPendingLinkRequests,
  acceptLinkRequest,
  declineLinkRequest,
  type InboxRequest
} from "@/lib/api/linkRequests";

function purposeLine(r: InboxRequest): string {
  if (r.kind === "HOUSEHOLD_LINK") {
    return `${r.requestingFamilyName} asks to link the household ${r.targetHouseholdName ?? ""}`.trim();
  }
  if (r.direction === "JOIN") {
    return `${r.targetName ?? "Someone"} asks to join ${r.requestingFamilyName}`;
  }
  return `${r.requestingFamilyName} asks to add ${r.targetName ?? "you"}`;
}

export default function RequestsPage() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["link-requests-pending"],
    queryFn: () => getPendingLinkRequests(getToken)
  });
  const requests = data?.requests ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["link-requests-pending"] });
  }

  const accept = useMutation({ mutationFn: (id: string) => acceptLinkRequest(id, getToken), onSuccess: invalidate });
  const decline = useMutation({ mutationFn: (id: string) => declineLinkRequest(id, getToken), onSuccess: invalidate });
  const busy = accept.isPending || decline.isPending;

  return (
    <div style={{ maxWidth: "640px", margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "16px" }}>
        Requests
      </h1>

      {isLoading && (
        <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>Loading…</p>
      )}
      {!isLoading && requests.length === 0 && (
        <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>You have no pending requests.</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {requests.map((r) => (
          <div
            key={r.id}
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: "10px",
              padding: "14px 16px"
            }}
          >
            <div style={{ fontSize: "14px", color: "var(--text-primary)", fontWeight: 600 }}>
              {r.requestingFamilyName}
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "4px 0 12px" }}>
              {purposeLine(r)}
            </div>
            {r.carryHouseholdName && (
              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "12px" }}>
                Also adds you to the household: {r.carryHouseholdName}.
              </div>
            )}
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => accept.mutate(r.id)}
                disabled={busy}
                style={{
                  padding: "8px 18px",
                  borderRadius: "8px",
                  border: "none",
                  background: "var(--color-primary, #6366f1)",
                  color: "#fff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: busy ? "not-allowed" : "pointer"
                }}
              >
                Accept
              </button>
              <button
                onClick={() => decline.mutate(r.id)}
                disabled={busy}
                style={{
                  padding: "8px 18px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  background: "var(--bg-card)",
                  color: "var(--text-secondary)",
                  fontSize: "13px",
                  cursor: busy ? "not-allowed" : "pointer"
                }}
              >
                Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
