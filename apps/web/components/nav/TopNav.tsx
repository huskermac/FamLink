"use client";

import Link from "next/link";
import { useState } from "react";
import { NAV_ITEMS, type NavItem } from "@/lib/nav";

function DropdownItem({ item }: { item: NavItem }) {
  const [open, setOpen] = useState(false);
  const hasChildren = Array.isArray(item.children) && item.children.length > 0;

  if (!hasChildren) {
    return (
      <Link
        href={item.href}
        style={{ padding: "8px 12px", color: "var(--text-secondary)", textDecoration: "none", fontSize: "13px" }}
      >
        {item.label}
      </Link>
    );
  }

  return (
    <div style={{ position: "relative" }} onMouseLeave={() => setOpen(false)}>
      <button
        onMouseEnter={() => setOpen(true)}
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: "8px 12px",
          color: "var(--text-secondary)",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: "13px",
        }}
      >
        {item.label}
      </button>
      {open && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          background: "var(--bg-sidebar)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          minWidth: "140px",
          zIndex: 50,
        }}>
          {item.children!.map((child) => (
            <Link
              key={child.href}
              href={child.href}
              style={{
                display: "block",
                padding: "8px 12px",
                color: "var(--text-secondary)",
                textDecoration: "none",
                fontSize: "13px",
              }}
            >
              {child.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopNav() {
  return (
    <header style={{
      background: "var(--bg-sidebar)",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      gap: "4px",
      padding: "0 16px",
      height: "48px",
      flexShrink: 0,
    }}>
      <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: "15px", marginRight: "16px" }}>
        FamLink
      </span>
      {NAV_ITEMS.map((item) => (
        <DropdownItem key={item.href} item={item} />
      ))}
    </header>
  );
}
