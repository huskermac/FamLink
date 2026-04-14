import Link from "next/link";
import type { EventSummary } from "@/lib/api/events";

interface Props {
  event: EventSummary;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });
}

export function EventCard({ event }: Props) {
  return (
    <Link
      href={`/events/${event.id}`}
      className="flex flex-col gap-1 rounded-lg border border-slate-700 bg-slate-800/60 p-4 hover:bg-slate-800 transition-colors"
    >
      <span className="text-base font-semibold text-slate-100">{event.title}</span>
      <span className="text-sm text-slate-400">
        {formatDate(event.startAt)} at {formatTime(event.startAt)}
      </span>
      {event.locationName && (
        <span className="text-xs text-slate-500">{event.locationName}</span>
      )}
      {event.isBirthdayEvent && (
        <span className="mt-1 w-fit rounded-full bg-indigo-900/50 px-2 py-0.5 text-xs text-indigo-300">
          Birthday
        </span>
      )}
    </Link>
  );
}
