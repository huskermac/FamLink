"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { NAV_ITEMS, type NavItem } from "@/lib/nav";
import { RequestsBadge } from "@/components/nav/RequestsBadge";

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 10 10" fill="none"
      style={{
        transform: open ? "rotate(0deg)" : "rotate(-90deg)",
        transition: "transform 0.15s",
        color: "var(--text-muted)",
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
  const textColor = isActive ? "var(--sidebar-active-text)" : "var(--text-secondary)";

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
            background: isActive ? "var(--sidebar-active-bg)" : "transparent",
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
        background: isActive && !hasChildren ? "var(--sidebar-active-bg)" : "transparent",
        color: depth > 0 ? "var(--text-muted)" : textColor,
        textDecoration: "none",
        fontSize: "13px",
      }}
    >
      {depth === 0 && <span style={{ fontSize: "15px" }}>{item.icon}</span>}
      {depth > 0 && <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>·</span>}
      {item.label}
      {item.href === "/requests" && <RequestsBadge />}
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
        background: "var(--bg-sidebar)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div style={{
        padding: "16px",
        borderBottom: "1px solid var(--border)",
        color: "var(--accent)",
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
        borderTop: "1px solid var(--border)",
        color: "var(--text-muted)",
        fontSize: "12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <span>{user?.firstName ?? ""}</span>
        <Link
          href="/settings"
          style={{ color: "var(--text-muted)", textDecoration: "none", fontSize: "16px", lineHeight: 1 }}
          title="Settings"
        >
          ⚙️
        </Link>
      </div>
    </aside>
  );
}
