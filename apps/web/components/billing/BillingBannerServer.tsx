import { auth } from "@clerk/nextjs/server";
import { BillingBanners } from "./BillingBanners";
import type { FamilySubscription } from "@/lib/api/billing";

async function getSubscription(token: string | null): Promise<FamilySubscription | null> {
  if (!token) return null;
  try {
    const base = process.env.NEXT_PUBLIC_API_URL;
    const res = await fetch(`${base}/api/v1/billing/subscription`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.subscription ?? null;
  } catch {
    return null;
  }
}

export async function BillingBannerServer() {
  const { getToken } = await auth();
  const token = await getToken();
  const subscription = await getSubscription(token);
  if (!subscription) return null;
  return <BillingBanners subscription={subscription} />;
}
