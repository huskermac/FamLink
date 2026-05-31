import { apiFetch } from "@/lib/api";

export interface PricingTier {
  tierKey: string;
  displayName: string;
  activeUserLimit: number | null;
  stripePriceId: string | null;
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

export async function fetchSubscription(getToken: () => Promise<string | null>): Promise<FamilySubscription | null> {
  try {
    const data = await apiFetch<{ subscription: FamilySubscription }>("/api/v1/billing/subscription", { getToken });
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
  cancelUrl: string
): Promise<string> {
  const data = await apiFetch<{ checkoutUrl: string }>("/api/v1/billing/checkout", {
    getToken,
    method: "POST",
    body: JSON.stringify({ tierKey, seats, successUrl, cancelUrl })
  });
  return data.checkoutUrl;
}

export async function createPortalSession(getToken: () => Promise<string | null>): Promise<string> {
  const data = await apiFetch<{ portalUrl: string }>("/api/v1/billing/portal", { getToken, method: "POST" });
  return data.portalUrl;
}

export async function getSeatImpact(
  getToken: () => Promise<string | null>,
  newSeatCount: number
): Promise<SeatImpact> {
  return apiFetch<SeatImpact>("/api/v1/billing/seat-impact", {
    getToken,
    method: "POST",
    body: JSON.stringify({ newSeatCount })
  });
}
