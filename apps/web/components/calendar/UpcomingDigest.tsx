import type { DigestSummary } from "@/lib/api/calendar";

interface Props {
  digest: DigestSummary;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

export function UpcomingDigest({ digest }: Props) {
  const hasContent = digest.events.length > 0 || digest.birthdays.length > 0;

  return (
    <aside className="flex flex-col gap-4 min-w-[200px]">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        This Week
      </h2>

      {!hasContent && (
        <p className="text-sm text-slate-500 italic">Nothing coming up.</p>
      )}

      {digest.events.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-slate-500">Events</p>
          {digest.events.map((item) => (
            <div key={item.id} className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-slate-200">{item.title}</span>
              <span className="text-xs text-slate-500">{formatDate(item.startAt)}</span>
            </div>
          ))}
        </div>
      )}

      {digest.birthdays.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-slate-500">Birthdays</p>
          {digest.birthdays.map((item) => (
            <div key={item.id} className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-purple-300">{item.title}</span>
              <span className="text-xs text-slate-500">{formatDate(item.startAt)}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
