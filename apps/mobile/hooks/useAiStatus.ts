import { useQuery } from "@tanstack/react-query";
import { useApiFetch } from "../lib/api";

export interface AiStatus {
  queriesUsedToday: number;
  queriesRemaining: number;
  dailyLimit: number;
  effectiveLimit: number;
  covered: boolean;
  foreignContext: boolean;
  resetAt: string;
}

export function useAiStatus(familyId: string | null) {
  const apiFetch = useApiFetch();
  return useQuery({
    queryKey: ["aiStatus", familyId],
    queryFn: () => apiFetch<AiStatus>(`/api/v1/ai/status?familyGroupId=${encodeURIComponent(familyId ?? "")}`),
    enabled: familyId !== null,
    refetchInterval: false,
  });
}
