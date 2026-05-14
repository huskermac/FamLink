import type { EventType } from "@/lib/api/events";

export interface EventTypeConfig {
  bar: string;
  badgeBg: string;
  badgeText: string;
  label: string;
}

export const EVENT_TYPE_CONFIG: Record<EventType, EventTypeConfig> = {
  HOLIDAY:  { bar: "#ef4444", badgeBg: "#fee2e2", badgeText: "#b91c1c", label: "Holiday" },
  BIRTHDAY: { bar: "#a78bfa", badgeBg: "#ede9fe", badgeText: "#7c3aed", label: "Birthday" },
  SPORTS:   { bar: "#22c55e", badgeBg: "#dcfce7", badgeText: "#15803d", label: "Sports" },
  SCHOOL:   { bar: "#f59e0b", badgeBg: "#fef3c7", badgeText: "#b45309", label: "School" },
  OTHER:    { bar: "#94a3b8", badgeBg: "#f1f5f9", badgeText: "#64748b", label: "Other" },
};
