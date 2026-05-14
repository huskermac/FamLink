import { QueryProvider } from "@/components/QueryProvider";
import { NavProvider } from "@/contexts/NavContext";
import { NavShell } from "@/components/nav/NavShell";
import { ThemeProvider } from "@/contexts/ThemeContext";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <NavProvider>
          <NavShell>{children}</NavShell>
        </NavProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}
