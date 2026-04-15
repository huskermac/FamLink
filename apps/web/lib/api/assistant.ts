const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface AiStatus {
  queriesUsedToday: number;
  queriesRemaining: number;
  resetAt: string;
}

type GetToken = () => Promise<string | null>;

export async function getAiStatus(getToken: GetToken): Promise<AiStatus> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}/api/v1/ai/status`, {
    headers: { Authorization: `Bearer ${token ?? ""}` }
  });
  if (!res.ok) throw new Error("Failed to fetch AI status");
  return res.json() as Promise<AiStatus>;
}
