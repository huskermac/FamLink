"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { NAV_ITEMS, type NavItem } from "@/lib/nav";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 10 10" fill="none"
      style={{
        transform: open ? "rotate(0deg)" : "rotate(-90deg)",
        transition: "transform 0.15s",
        color: "#64748b",
      }}
    >
      <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NavItemRow({ item, depth = 0 }: { item: NavItem; depth?: number }) {
  const pathname = usePathname();
  const hasChildren = Array.isArray(item.children) && item.children.length > 0;
  const isActive = pathname === item.href || (hasChildren && pathname.startsWith(item.href + "/"));
  const [open, setOpen] = useState(isActive);

  const paddingLeft = depth === 0 ? "16px" : "40px";
  const textColor = isActive ? "#e2e8f0" : "#94a3b8";
  const bg = isActive && !hasChildren ? "#1e293b" : "transparent";

  if (hasChildren) {
    return (
      <div>
        <button
          aria-expanded={open}
          aria-label={item.label}
          onClick={() => setOpen((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            padding: `8px 16px 8px ${paddingLeft}`,
            background: isActive ? "#1e293b" : "transparent",
            border: "none",
            cursor: "pointer",
            color: textColor,
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "15px" }}>{item.icon}</span>
            <span style={{ fontSize: "13px" }}>{item.label}</span>
          </span>
          <ChevronIcon open={open} />
        </button>
        {open && (
          <div>
            {item.children!.map((child) => (
              <NavItemRow key={child.href} item={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: `8px 16px 8px ${paddingLeft}`,
        background: bg,
        color: depth > 0 ? "#64748b" : textColor,
        textDecoration: "none",
        fontSize: "13px",
      }}
    >
      {depth === 0 && <span style={{ fontSize: "15px" }}>{item.icon}</span>}
      {depth > 0 && <span style={{ fontSize: "11px", color: "#475569" }}>·</span>}
      {item.label}
    </Link>
  );
}

export function Sidebar() {
  const { user } = useUser();

  return (
    <aside
      style={{
        width: "200px",
        minHeight: "100vh",
        background: "#0f172a",
        borderRight: "1px solid #1e293b",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div style={{
        padding: "16px",
        borderBottom: "1px solid #1e293b",
        color: "#6366f1",
        fontWeight: 700,
        fontSize: "15px",
        letterSpacing: "0.02em",
      }}>
        FamLink
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, padding: "8px 0", overflowY: "auto" }}>
        {NAV_ITEMS.map((item) => (
          <NavItemRow key={item.href} item={item} />
        ))}
      </nav>

      {/* User area */}
      <div style={{
        padding: "12px 16px",
        borderTop: "1px solid #1e293b",
        color: "#475569",
        fontSize: "12px",
      }}>
        {user?.firstName ?? ""}
      </div>
    </aside>
  );
}
