"use client";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getMyFamilies, getFamilyDetails } from "@/lib/api/family";
import { getEventInviteeSuggestions, sendInvitations } from "@/lib/api/events";
import type { InviteeEntry, InviteeSuggestion } from "@/lib/api/events";

export default function InvitePage() {
  const { eventId } = useParams<{ eventId: string }>();
  const router = useRouter();
  const { getToken } = useAuth();

  const [selectedPersonIds, setSelectedPersonIds] = useState<Set<string>>(new Set());
  const [externalName, setExternalName]   = useState("");
  const [externalEmail, setExternalEmail] = useState("");
  const [externalPhone, setExternalPhone] = useState("");
  const [sending, setSending] = useState(false);

  const familiesQuery = useQuery({
    queryKey: ["families"],
    queryFn:  () => getMyFamilies(getToken),
  });
  const familyId = familiesQuery.data?.[0]?.familyGroup.id ?? null;

  const { data: familyData } = useQuery({
    queryKey: ["family-detail", familyId],
    queryFn:  () => getFamilyDetails(familyId!, getToken),
    enabled:  !!familyId,
  });

  const { data: suggestionsData } = useQuery({
    queryKey: ["invitee-suggestions", eventId],
    queryFn:  () => getEventInviteeSuggestions(eventId, getToken),
    enabled:  !!eventId,
  });

  function togglePerson(personId: string) {
    setSelectedPersonIds(prev => {
      const next = new Set(prev);
      next.has(personId) ? next.delete(personId) : next.add(personId);
      return next;
    });
  }

  async function handleSend() {
    setSending(true);
    const invitees: InviteeEntry[] = [
      ...[...selectedPersonIds].map(id => ({ personId: id })),
      ...(externalEmail || externalPhone
        ? [{ guestEmail: externalEmail || undefined, guestPhone: externalPhone || undefined, guestName: externalName || "Guest" }]
        : [])
    ];
    if (invitees.length > 0) {
      await sendInvitations(eventId, invitees, getToken);
    }
    router.push(`/events/${eventId}`);
  }

  const members = familyData?.members ?? [];
  const suggestions: InviteeSuggestion[] = suggestionsData?.suggestions ?? [];

  return (
    <div style={{ maxWidth: "540px", margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "4px" }}>
        Invite people
      </h1>
      <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "24px" }}>
        Select family members or add external guests.
      </p>

      {members.length > 0 && (
        <section style={{ marginBottom: "24px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "8px" }}>
            Family members
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {members.map(m => {
              const displayName = m.person.preferredName ?? `${m.person.firstName} ${m.person.lastName}`.trim();
              return (
                <label key={m.person.id} style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer",
                                                   background: "var(--bg-card)", border: "1px solid var(--border)",
                                                   borderRadius: "8px", padding: "10px 12px" }}>
                  <input
                    type="checkbox"
                    checked={selectedPersonIds.has(m.person.id)}
                    onChange={() => togglePerson(m.person.id)}
                    style={{ accentColor: "var(--color-primary, #6366f1)", width: "16px", height: "16px" }}
                  />
                  <span style={{ fontSize: "14px", color: "var(--text-primary)" }}>{displayName}</span>
                </label>
              );
            })}
          </div>
        </section>
      )}

      {suggestions.length > 0 && (
        <section style={{ marginBottom: "24px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "8px" }}>
            Suggested guests
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {suggestions.map(s => (
              <label key={s.person.id} style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer",
                                                background: "var(--bg-card)", border: "1px solid var(--border)",
                                                borderRadius: "8px", padding: "10px 12px" }}>
                <input
                  type="checkbox"
                  checked={selectedPersonIds.has(s.person.id)}
                  onChange={() => togglePerson(s.person.id)}
                  style={{ accentColor: "var(--color-primary, #6366f1)", width: "16px", height: "16px" }}
                />
                <div>
                  <div style={{ fontSize: "14px", color: "var(--text-primary)" }}>{s.person.displayName}</div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    via {s.via.personName} · {s.via.relationshipType.toLowerCase()}
                    {s.sharedChildren.length > 0 && ` · co-parent of ${s.sharedChildren.map(c => c.displayName).join(", ")}`}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </section>
      )}

      <section style={{ marginBottom: "24px" }}>
        <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: "8px" }}>
          External guest
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <input
            placeholder="Name"
            value={externalName}
            onChange={e => setExternalName(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--border)",
                     background: "var(--bg-card)", fontSize: "14px", color: "var(--text-primary)" }}
          />
          <input
            placeholder="Email address"
            type="email"
            value={externalEmail}
            onChange={e => setExternalEmail(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--border)",
                     background: "var(--bg-card)", fontSize: "14px", color: "var(--text-primary)" }}
          />
          <input
            placeholder="Phone (optional)"
            type="tel"
            value={externalPhone}
            onChange={e => setExternalPhone(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--border)",
                     background: "var(--bg-card)", fontSize: "14px", color: "var(--text-primary)" }}
          />
        </div>
      </section>

      <div style={{ display: "flex", gap: "12px" }}>
        <button
          onClick={handleSend}
          disabled={sending}
          style={{ flex: 1, padding: "12px", borderRadius: "8px", border: "none",
                   background: "var(--color-primary, #6366f1)", color: "#fff",
                   fontSize: "15px", fontWeight: 600, cursor: sending ? "not-allowed" : "pointer" }}
        >
          {sending ? "Sending…" : "Send invitations"}
        </button>
        <button
          onClick={() => router.push(`/events/${eventId}`)}
          style={{ padding: "12px 20px", borderRadius: "8px", border: "1px solid var(--border)",
                   background: "var(--bg-card)", color: "var(--text-secondary)",
                   fontSize: "14px", cursor: "pointer" }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}
