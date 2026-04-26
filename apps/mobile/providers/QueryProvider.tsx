import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { REFRESH_INTERVAL_MS } from "../lib/config";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: REFRESH_INTERVAL_MS,
      staleTime: 5_000,
      retry: 1,
    },
  },
});

export function QueryProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
