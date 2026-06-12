import { apiFetch } from "@/lib/api";

export interface PricingTier {
  tierKey: string;
  displayName: string;
  activeUserLimit: number | null;
  stripePriceId: string | null;
  /** Active seats covered by the base price; only seats beyond this are billed. */
  includedSeats: number;
  trialDays: number | null;
  displayOrder: number;
  isActive: boolean;
}

export interface FamilySubscription {
  tierKey: string;
  seatCount: number;
  status: "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELED" | "SUSPENDED";
  trialEndsAt: string | null;
  pendingDowngradeTierKey: string | null;
  pendingDowngradeSeatCount: number | null;
  downgradeGraceEndsAt: string | null;
  grandfathered: boolean;
}

export interface SeatImpact {
  currentSeats: number;
  newSeats: number;
  immediateCharge: number;
  recurringIncrease: number;
  currency: string;
}

export async function fetchTiers(): Promise<PricingTier[]> {
  try {
    const base = process.env.NEXT_PUBLIC_API_URL;
    const res = await fetch(`${base}/api/v1/billing/tiers`, { cache: "no-store" });
    const data = await res.json();
    return data.tiers ?? [];
  } catch {
    return [];
  }
}

// familyGroupId is optional for single-family users; the API requires it once
// a user belongs to more than one family. Billing mutations are admin-only.
export async function fetchSubscription(
  getToken: () => Promise<string | null>,
  familyGroupId?: string
): Promise<FamilySubscription | null> {
  try {
    const qs = familyGroupId ? `?familyGroupId=${encodeURIComponent(familyGroupId)}` : "";
    const data = await apiFetch<{ subscription: FamilySubscription }>(`/api/v1/billing/subscription${qs}`, { getToken });
    return data.subscription;
  } catch {
    return null;
  }
}

export async function createCheckoutSession(
  getToken: () => Promise<string | null>,
  tierKey: string,
  seats: number,
  successUrl: string,
  cancelUrl: string,
  familyGroupId?: string
): Promise<string> {
  const data = await apiFetch<{ checkoutUrl: string }>("/api/v1/billing/checkout", {
    getToken,
    method: "POST",
    body: JSON.stringify({ tierKey, seats, successUrl, cancelUrl, familyGroupId })
  });
  return data.checkoutUrl;
}

export async function createPortalSession(
  getToken: () => Promise<string | null>,
  familyGroupId?: string
): Promise<string> {
  const data = await apiFetch<{ portalUrl: string }>("/api/v1/billing/portal", {
    getToken,
    method: "POST",
    body: JSON.stringify({ familyGroupId })
  });
  return data.portalUrl;
}

export async function getSeatImpact(
  getToken: () => Promise<string | null>,
  newSeatCount: number,
  familyGroupId?: string
): Promise<SeatImpact> {
  return apiFetch<SeatImpact>("/api/v1/billing/seat-impact", {
    getToken,
    method: "POST",
    body: JSON.stringify({ newSeatCount, familyGroupId })
  });
}

export async function activateFree(
  getToken: () => Promise<string | null>,
  familyGroupId?: string
): Promise<void> {
  await apiFetch<{ activated: boolean }>("/api/v1/billing/activate-free", {
    getToken,
    method: "POST",
    body: JSON.stringify({ familyGroupId })
  });
}
