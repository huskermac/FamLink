"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { previewParticipation, acceptParticipation, declineParticipation, type ParticipationPreview } from "@/lib/api/events";

type View = "loading" | "pending" | "declined" | "unavailable" | "declined-confirmed";

export function AcceptClient({ token }: { token: string }) {
  const router = useRouter();
  const { getToken } = useAuth();
  const [preview, setPreview] = useState<ParticipationPreview | null>(null);
  const [view, setView] = useState<View>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    previewParticipation(token, getToken)
      .then((p) => {
        if (!active) return;
        if (p.state === "ACTIVE" && p.eventId) { router.push(`/events/${p.eventId}`); return; }
        if (p.state === "PENDING") { setPreview(p); setView("pending"); return; }
        if (p.state === "DECLINED") { setPreview(p); setView("declined"); return; }
        setView("unavailable");
      })
      .catch(() => { if (active) setView("unavailable"); });
    return () => { active = false; };
    // Intentionally omit getToken/router: this is a one-shot preview fetch on mount.
    // In production, getToken (Clerk) and router (Next App Router) are referentially stable,
    // so token is the only value that should trigger a re-run.
  }, [token]);

  async function onAccept() {
    if (!preview?.eventId) return;
    setBusy(true);
    try { await acceptParticipation(preview.eventId, token, getToken); router.push(`/events/${preview.eventId}`); }
    finally { setBusy(false); }
  }

  async function onDecline() {
    if (!preview?.eventId) return;
    setBusy(true);
    try { await declineParticipation(preview.eventId, token, getToken); setView("declined-confirmed"); }
    finally { setBusy(false); }
  }

  if (view === "loading") return <main style={{ padding: 24 }}><p>Loading…</p></main>;

  if (view === "unavailable") {
    return <main style={{ maxWidth: 480, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>This invitation is no longer available</h1>
      <p style={{ marginTop: 8 }}><Link href="/">Go home</Link></p>
    </main>;
  }

  if (view === "declined-confirmed") {
    return <main style={{ maxWidth: 480, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>You declined this invitation</h1>
      <p style={{ marginTop: 8 }}><Link href="/">Go home</Link></p>
    </main>;
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>{preview?.eventTitle}</h1>
      <p style={{ marginTop: 4, color: "var(--text-muted)" }}>
        Invited by {preview?.invitedByName} as {preview?.role === "EVENT_ADMIN" ? "an event admin" : "a participant"}
      </p>
      {preview?.startAt && <p style={{ marginTop: 4 }}>{new Date(preview.startAt).toLocaleString()}</p>}
      {preview?.locationName && <p style={{ color: "var(--text-muted)" }}>{preview.locationName}</p>}
      {view === "declined" && <p style={{ marginTop: 12 }}>You declined this earlier — want back in?</p>}
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button onClick={onAccept} disabled={busy} style={{ padding: "10px 16px", fontWeight: 600 }}>Accept</button>
        {view === "pending" && <button onClick={onDecline} disabled={busy} style={{ padding: "10px 16px" }}>Decline</button>}
      </div>
    </main>
  );
}
