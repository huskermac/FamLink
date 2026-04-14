"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { getMyFamilies } from "@/lib/api/family";
import { createEvent } from "@/lib/api/events";

export default function NewEventPage() {
  const router = useRouter();
  const { getToken } = useAuth();

  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const familiesQuery = useQuery({
    queryKey: ["families"],
    queryFn: () => getMyFamilies(getToken)
  });

  const familyId = familiesQuery.data?.[0]?.familyGroup.id ?? null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!startTime) {
      setError("Start time is required.");
      return;
    }
    const startDate = new Date(startTime);
    if (startDate <= new Date()) {
      setError("Start time must be in the future.");
      return;
    }
    if (!familyId) {
      setError("Could not resolve your family. Please try again.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await createEvent(
        familyId,
        {
          title: title.trim(),
          startAt: startDate.toISOString(),
          ...(endTime ? { endAt: new Date(endTime).toISOString() } : {}),
          ...(location.trim() ? { locationName: location.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {})
        },
        getToken
      );
      router.push(`/events/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create event.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-lg">
      <h1 className="text-xl font-semibold text-slate-100">Create Event</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="title" className="text-sm font-medium text-slate-300">
            Title <span className="text-red-400">*</span>
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Summer BBQ"
            className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="startTime" className="text-sm font-medium text-slate-300">
            Start time <span className="text-red-400">*</span>
          </label>
          <input
            id="startTime"
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="endTime" className="text-sm font-medium text-slate-300">
            End time <span className="text-slate-500">(optional)</span>
          </label>
          <input
            id="endTime"
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="location" className="text-sm font-medium text-slate-300">
            Location <span className="text-slate-500">(optional)</span>
          </label>
          <input
            id="location"
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="123 Main St"
            className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="description" className="text-sm font-medium text-slate-300">
            Description <span className="text-slate-500">(optional)</span>
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Tell people what to expect…"
            className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none resize-none"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting || familiesQuery.isLoading}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create Event"}
        </button>
      </form>
    </div>
  );
}
