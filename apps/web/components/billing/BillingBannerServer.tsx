import { auth } from "@clerk/nextjs/server";
import { BillingBanners } from "./BillingBanners";
import type { FamilySubscription } from "@/lib/api/billing";

async function getSubscription(token: string | null): Promise<FamilySubscription | null> {
  if (!token) return null;
  try {
    const base = process.env.NEXT_PUBLIC_API_URL;
    const headers = { Authorization: `Bearer ${token}` };

    // Billing is family-scoped; use the same first family the app shell shows.
    const famRes = await fetch(`${base}/api/v1/persons/me/families`, { headers, cache: "no-store" });
    if (!famRes.ok) return null;
    const families = (await famRes.json()) as Array<{ familyGroup: { id: string } }>;
    const familyGroupId = families[0]?.familyGroup.id;
    if (!familyGroupId) return null;

    const res = await fetch(
      `${base}/api/v1/billing/subscription?familyGroupId=${encodeURIComponent(familyGroupId)}`,
      { headers, cache: "no-store" }
    );
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
