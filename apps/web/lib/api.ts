/**
 * Authenticated fetch to the FamLink Express API.
 * Pass `getToken` from `useAuth()` in client components, or from `auth()` in Server Components.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit & { getToken: () => Promise<string | null> }
): Promise<T> {
  const { getToken, ...init } = options;
  const token = await getToken();
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) {
    throw new Error("NEXT_PUBLIC_API_URL is not set");
  }
  const url = `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(url, { ...init, headers, cache: init.cache ?? "no-store" });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const msg =
      typeof parsed === "object" && parsed !== null && "error" in parsed
        ? String((parsed as { error: string }).error)
        : text || res.statusText;
    throw new Error(`API ${res.status}: ${msg}`);
  }
  return parsed as T;
}
