"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addItem, deleteItem, type ForeignEventDTO } from "@/lib/api/events";
import { RsvpButton } from "@/components/events/RsvpButton";

export function ForeignEventDetail({ dto, eventId }: { dto: ForeignEventDTO; eventId: string }) {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const [newItem, setNewItem] = useState("");

  const add = useMutation({
    mutationFn: (name: string) => addItem(eventId, { name }, getToken),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["event", eventId] })
  });
  const remove = useMutation({
    mutationFn: (itemId: string) => deleteItem(eventId, itemId, getToken),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["event", eventId] })
  });

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>{dto.title}</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>{new Date(dto.startAt).toLocaleString()}</p>
        {dto.locationName && <p className="text-sm" style={{ color: "var(--text-muted)" }}>{dto.locationName}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Your RSVP</p>
        <RsvpButton eventId={eventId} currentStatus={null} />
      </div>

      {dto.description && <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{dto.description}</p>}

      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Attendees</p>
        {dto.participants.length === 0
          ? <p className="text-xs italic" style={{ color: "var(--text-muted)" }}>None yet</p>
          : dto.participants.map((p, i) => (
              <div key={i} className="flex items-center justify-between rounded-md px-3 py-2" style={{ border: "1px solid var(--border)", background: "var(--bg-card)" }}>
                <span className="text-sm" style={{ color: "var(--text-primary)" }}>{p.displayName}</span>
                {p.rsvpStatus && <span className="text-xs" style={{ color: "var(--text-muted)" }}>{p.rsvpStatus}</span>}
              </div>
            ))}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Items</p>
        {dto.tasks.map((t) => (
          <div key={t.id} className="flex items-center justify-between rounded-md px-3 py-2" style={{ border: "1px solid var(--border)", background: "var(--bg-card)" }}>
            <span className="text-sm" style={{ color: "var(--text-primary)" }}>{t.name}{t.quantity ? ` · ${t.quantity}` : ""}</span>
            {t.isOwn && <button onClick={() => remove.mutate(t.id)} className="text-xs" style={{ color: "var(--danger, #dc2626)" }}>Delete</button>}
          </div>
        ))}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            aria-label="add item"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            placeholder="Add an item"
            style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)" }}
          />
          <button onClick={() => { if (newItem.trim()) { add.mutate(newItem.trim()); setNewItem(""); } }} style={{ padding: "8px 12px" }}>Add</button>
        </div>
      </div>
    </div>
  );
}
