const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface AiStatus {
  queriesUsedToday: number;
  queriesRemaining: number;
  dailyLimit: number;
  effectiveLimit: number;
  covered: boolean;
  foreignContext: boolean;
  resetAt: string;
}

type GetToken = () => Promise<string | null>;

export async function getAiStatus(getToken: GetToken, familyGroupId?: string): Promise<AiStatus> {
  const token = await getToken();
  const qs = familyGroupId ? `?familyGroupId=${encodeURIComponent(familyGroupId)}` : "";
  const res = await fetch(`${API_BASE}/api/v1/ai/status${qs}`, { headers: { Authorization: `Bearer ${token ?? ""}` } });
  if (!res.ok) throw new Error("Failed to fetch AI status");
  return res.json() as Promise<AiStatus>;
}
