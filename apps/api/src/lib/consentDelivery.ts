import type { LinkRequest } from "@famlink/db";

/**
 * Passive-target consent delivery (SMS/email) for a TOKEN-classified LinkRequest.
 * STUB for Task 4 — a no-op. Task 6 fills this in with the real SMS/email send
 * pointing at the PR-3 web page (`WEB_APP_URL/consent/:token`). Callers in
 * `routes/linkRequests.ts` treat this as best-effort and must not let a
 * delivery failure fail the request that triggered it.
 */
export async function deliverConsentLink(args: { request: LinkRequest; personId: string }): Promise<void> {
  void args;
}
