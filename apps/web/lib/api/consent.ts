const apiBase = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface ConsentView {
  familyName: string;
  targetName: string | null;
  status: string;
  notice: string;
}

export interface ConsentAcceptResult {
  granted: boolean;
  status: string;
}

export async function getConsentRequest(token: string): Promise<ConsentView> {
  const res = await fetch(`${apiBase()}/api/v1/consent/${encodeURIComponent(token)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body?.error === "string" ? body.error : "Request not found");
  }
  return res.json();
}

// The accept endpoint returns a body on both 200 (granted) and 409 (already resolved). The page
// reads `granted` and `status`, so return the body in both cases and never throw on a 409.
export async function acceptConsentRequest(token: string): Promise<ConsentAcceptResult> {
  const res = await fetch(`${apiBase()}/api/v1/consent/${encodeURIComponent(token)}/accept`, {
    method: "POST"
  });
  return res.json();
}
