import { useAuth } from "@clerk/clerk-expo";
import { API_BASE } from "./config";

export function useApiFetch() {
  const { getToken } = useAuth();

  return async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getToken();
    const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string>),
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const res = await fetch(url, { ...init, headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (json as { error?: string }).error ?? `HTTP ${res.status}`;
      throw new Error(`API ${res.status}: ${msg}`);
    }
    return json as T;
  };
}
