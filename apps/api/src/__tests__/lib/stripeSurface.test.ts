/**
 * Stripe SDK surface characterization (P3-00).
 *
 * The route tests mock the Stripe client wholesale, so they cannot detect when
 * the installed SDK drops or renames a method (e.g. `invoices.retrieveUpcoming`
 * was removed in stripe-node v17). This suite constructs the REAL client — no
 * vi.mock — and asserts every method `routes/billing.ts` invokes actually exists.
 *
 * Update this list in the same commit as any Stripe call-site change.
 */
import { describe, it, expect } from "vitest";
import Stripe from "stripe";

const stripe = new Stripe("sk_test_surface_check_only");

const usedMethods: Array<[string, unknown]> = [
  ["customers.create", stripe.customers.create],
  ["checkout.sessions.create", stripe.checkout.sessions.create],
  ["billingPortal.sessions.create", stripe.billingPortal.sessions.create],
  ["subscriptions.retrieve", stripe.subscriptions.retrieve],
  ["subscriptions.update", stripe.subscriptions.update],
  ["subscriptions.cancel", stripe.subscriptions.cancel],
  ["invoices.createPreview", stripe.invoices.createPreview],
  ["webhooks.constructEvent", stripe.webhooks.constructEvent]
];

describe("stripe SDK surface used by routes/billing.ts", () => {
  it.each(usedMethods)("%s is a function on the installed SDK", (_name, fn) => {
    expect(typeof fn).toBe("function");
  });
});
