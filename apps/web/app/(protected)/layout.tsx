import { QueryProvider } from "@/components/QueryProvider";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>;
}
