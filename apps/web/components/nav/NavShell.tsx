// apps/web/components/nav/NavShell.tsx
"use client";

import { useNavOrientation } from "@/contexts/NavContext";
import { Sidebar } from "@/components/nav/Sidebar";
import { TopNav } from "@/components/nav/TopNav";
import { Breadcrumbs } from "@/components/nav/Breadcrumbs";

export function NavShell({ children }: { children: React.ReactNode }) {
  const { orientation } = useNavOrientation();

  if (orientation === "topnav") {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <TopNav />
        <main style={{ flex: 1, overflowY: "auto" }}>
          <Breadcrumbs />
          {children}
        </main>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <main style={{ flex: 1, overflowY: "auto", background: "#1e293b", color: "#e2e8f0" }}>
        <Breadcrumbs />
        {children}
      </main>
    </div>
  );
}
