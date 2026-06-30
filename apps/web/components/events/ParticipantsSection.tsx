"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listParticipants, revokeParticipant, setParticipantRole, type ParticipantRecord } from "@/lib/api/events";

export function ParticipantsSection({ eventId, canAdmin }: { eventId: string; canAdmin: boolean }) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["participants", eventId], queryFn: () => listParticipants(eventId, getToken) });

  const revoke = useMutation({
    mutationFn: (personId: string) => revokeParticipant(eventId, personId, getToken),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["participants", eventId] })
  });
  const setRole = useMutation({
    mutationFn: ({ personId, role }: { personId: string; role: "PARTICIPANT" | "EVENT_ADMIN" }) => setParticipantRole(eventId, personId, role, getToken),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["participants", eventId] })
  });

  if (isLoading) return null;
  const participants: ParticipantRecord[] = data?.participants ?? [];
  if (participants.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Participants</p>
      {participants.map((p) => (
        <div key={p.personId} className="flex items-center justify-between rounded-md px-3 py-2"
             style={{ border: "1px solid var(--border)", background: "var(--bg-card)", opacity: p.status === "REVOKED" ? 0.5 : 1 }}>
          <span className="text-sm" style={{ color: "var(--text-primary)" }}>
            {p.displayName} <span className="text-xs" style={{ color: "var(--text-muted)" }}>· {p.role === "EVENT_ADMIN" ? "admin" : "participant"}{p.status === "REVOKED" ? " · revoked" : ""}</span>
          </span>
          {canAdmin && p.status === "ACTIVE" && (
            <span style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setRole.mutate({ personId: p.personId, role: p.role === "EVENT_ADMIN" ? "PARTICIPANT" : "EVENT_ADMIN" })} className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {p.role === "EVENT_ADMIN" ? "Make participant" : "Make admin"}
              </button>
              <button onClick={() => revoke.mutate(p.personId)} className="text-xs" style={{ color: "var(--danger, #dc2626)" }}>Revoke</button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
