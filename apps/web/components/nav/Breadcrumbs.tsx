"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SEGMENT_LABELS: Record<string, string> = {
  dashboard:  "Dashboard",
  events:     "Events",
  family:     "Family",
  calendar:   "Calendar",
  assistant:  "AI Assistant",
  members:    "Members",
  new:        "New",
};

function labelFor(segment: string): string {
  return SEGMENT_LABELS[segment] ?? segment;
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  // Nothing to show on the root protected page
  if (segments.length === 0 || (segments.length === 1 && segments[0] === "dashboard")) {
    return null;
  }

  const crumbs = segments.map((seg, i) => ({
    label: labelFor(seg),
    href: "/" + segments.slice(0, i + 1).join("/"),
    isLast: i === segments.length - 1,
  }));

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 px-6 pt-4 pb-2 text-xs">
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-1">
          {i > 0 && <span style={{ color: "#475569" }}>›</span>}
          {crumb.isLast ? (
            <span style={{ color: "#94a3b8" }}>{crumb.label}</span>
          ) : (
            <Link href={crumb.href} style={{ color: "#64748b" }}
              className="hover:text-slate-400 transition-colors">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
