// apps/web/app/(protected)/layout.tsx
import { QueryProvider } from "@/components/QueryProvider";
import { NavProvider } from "@/contexts/NavContext";
import { NavShell } from "@/components/nav/NavShell";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <NavProvider>
        <NavShell>{children}</NavShell>
      </NavProvider>
    </QueryProvider>
  );
}
