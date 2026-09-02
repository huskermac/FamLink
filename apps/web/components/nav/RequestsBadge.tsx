"use client";
import { useLinkRequestCount } from "@/hooks/useLinkRequestCount";

export function RequestsBadge() {
  const count = useLinkRequestCount();
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} pending requests`}
      style={{
        marginLeft: "6px",
        minWidth: "16px",
        height: "16px",
        padding: "0 5px",
        borderRadius: "8px",
        background: "var(--color-primary, #6366f1)",
        color: "#fff",
        fontSize: "10px",
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      {count}
    </span>
  );
}
