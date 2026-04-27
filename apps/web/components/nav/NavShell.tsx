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
      <div className="flex flex-col min-h-screen">
        <TopNav />
        <main className="flex-1 overflow-y-auto">
          <Breadcrumbs />
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Breadcrumbs />
        {children}
      </main>
    </div>
  );
}
