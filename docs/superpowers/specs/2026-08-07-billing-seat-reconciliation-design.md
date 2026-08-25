# Billing — Usage-Based Seat Reconciliation (design spec)

| Field | Value |
|---|---|
| Date | 2026-08-07 (brainstorm with Steve, decisions locked in the session) |
| Phase | P3-04 (billing slice that enables W1 PR-2 consent flows) |
| Origin | W1 spec §2 **decision 10** (2026-08-07): "seat billing is decoupled from consent and reconciled from actual membership." This spec is that slice. |
| Status | Ready for Steve review → writing-plans |
| Sequencing | **Lands BEFORE W1 PR-2.** PR-2 then adds members and does not call Stripe. |

## 1. Goal

Remove seat billing from the member-add and consent path. The system adds a member with **no inline Stripe call and no seat confirmation that blocks the add**. The member is **covered immediately** (AI and paid features work at once). A daily job **reconciles the Stripe seat quantity for the family from the true active-member count**, so the next invoice shows reality. This removes three problems that the W1 PR-2 council round-2 review found: the request-time-against-accept-time staleness, the Stripe-after-commit failure window, and the deadlock. It also prevents surprise instant charges.

## 2. Locked decisions (Steve, 2026-08-07)

1. **A member add never calls Stripe and never blocks on billing.** This slice removes the 402 "confirm seat expansion" gate on the add.
2. **Coverage is immediate and cap-free.** A person is covered iff they are an active (non-suspended) member of ≥1 **paid, entitling** family (`status ∈ {ACTIVE, TRIALING}` and `PricingTier.stripePriceId != null`). This slice removes the `take: seatCount` entitlement cap in `entitlements.ts`. `seatCount` is no longer an entitlement cap. It becomes only the **billing quantity** that the reconciliation maintains.
3. **The daily cron reconciles billing from actual membership** (arrears, next cycle). The system makes no Stripe call for each membership change.
4. **This slice retires seat-based member suspension.** Because seats equal headcount, no member is "over the limit." This slice retires the downgrade-grace suspension pass and the `pendingDowngrade*` machinery. A tier downgrade changes price and features. It never suspends members automatically.
5. **This slice notifies the admin that the bill will change** when an add raises billable headcount. The slice surfaces this as an API response indicator. Richer delivery is UI-layer work for later.

## 3. Coverage model change (`apps/api/src/lib/entitlements.ts`)

Today `isPersonCoveredByFamily` loads active members with `orderBy joinedAt take: seatCount`. It then examines membership in that seated set. **Change:** remove the `take: seatCount` seat boundary. Coverage becomes:

```
covered-by-family(person, family) :=
  sub exists
  AND sub.status ∈ {ACTIVE, TRIALING}
  AND sub.pricingTier.stripePriceId != null   // free tier never covers
  AND person is an active (suspendedAt == null) FamilyMember of family
```

The new coverage does no seat-ordering query and applies no cap. `isPersonCovered`, `getAiDailyLimit*`, and `getAiEntitlementForUser` keep their shape and inherit the new definition. The AI daily-limit constants and the foreign-context logic do not change.

## 4. Add path change (`apps/api/src/routes/families.ts`)

`POST /:familyId/members`:
- Delete the full `if (targetPerson.userId) { checkSeatExpansion … Stripe … }` block. This block is the 402 gate and the inline Stripe seat update.
- The system creates the member unconditionally. The existing authz and the W1 PR-2 provenance and consent gate still apply. That gate lands in PR-2. This slice leaves the add path otherwise intact.
- **NOTE:** After W1 PR-2, direct-add targets are *passive, no-contact* records (`userId == null`). These records never affect billing, because billing counts only `userId != null` active members. So the billing-impact notice belongs to the **consent-accept** path (PR-2) and to **CIF activation**, not to this slice's direct-add. This slice provides the notice helper. PR-2 calls it.

This slice deletes `checkSeatExpansion` (`lib/subscriptionEnforcement.ts`). No caller remains after this slice. This slice does not create `applySeatIncrement` (named in the PR-2 round-2 plan). `reconcileSeats` supersedes it.

## 5. Reconciliation (`apps/api/src/lib/subscriptionEnforcement.ts` → `reconcileSeats`)

```
reconcileSeats(familyGroupId):
  sub = familySubscription (include pricingTier); if none → return
  if sub not entitling (status ∉ {ACTIVE,TRIALING}) or free tier (stripePriceId == null) → return
  activeCount = count(FamilyMember where familyGroupId, suspendedAt == null, person.userId != null)
  desiredQty = max(0, activeCount - pricingTier.includedSeats)
  # local billing quantity always tracks reality
  if sub.seatCount != activeCount: update sub.seatCount = activeCount
  # Stripe: only call when the quantity actually differs (avoid needless API calls)
  if sub.stripeSubscriptionId and pricingTier.stripeSeatPriceId:
    currentQty = quantity of the seat line item on the Stripe subscription (0 if absent)
    if currentQty != desiredQty:
      upsert the seat line item to desiredQty with proration_behavior: "create_prorations"
```

- **`proration_behavior: "create_prorations"`** (**Steve decided, 2026-08-15**): a mid-cycle seat change bills a member add, or credits a member removal, for the partial period. The next invoice settles this as true arrears. The system makes no immediate out-of-cycle charge. This adds proration line items to the next invoice. *(The first recommendation was `"none"` for predictability. Steve chose proration for billing accuracy.)*
- **Idempotent.** It sets an absolute quantity. The `currentQty != desiredQty` guard makes a re-run a no-op.
- The absolute-quantity math is the same math that `billing.ts` and `families.ts` use today (`max(0, seats - includedSeats)`). The Stripe interaction pattern does not change. Only its *trigger* moves to the cron.

## 6. Daily job (`apps/api/src/jobs/billingEnforcement.ts`)

- **Add** `runSeatReconciliationPass()`. It iterates entitling subscriptions and calls `reconcileSeats(familyGroupId)` for each. A per-family guard makes sure that one Stripe error does not abort the pass. Wire it into the existing `startBillingCron` 06:00 UTC schedule, next to `runTrialWarningPass`.
- **Remove** `runDowngradeEnforcementPass()` (the seat-based member-suspension pass) and its cron wiring (decision 4). Keep `runTrialWarningPass()`.
- The `customer.subscription.updated` webhook handler (`routes/webhooks.ts`) stays as the local `seatCount` convergence backstop. Make sure that it still sets `seatCount` from the Stripe quantity. No change is expected.

## 7. Billing-impact notice (helper this slice provides, PR-2/CIF consume)

`billingImpactForAdd(familyGroupId): Promise<{ willBill: boolean; note: string | null }>` — the helper returns two things. First, it shows if one more active member raises billable headcount beyond `includedSeats` on a paid tier. Second, it gives a plain-language note ("This will be reflected on your next invoice."). This slice defines and unit-tests the helper. **The W1 PR-2 accept path returns it in the response.** The slice can also surface it at CIF activation. This slice builds no new delivery channel.

## 8. Retired / vestigial (name these in the plan. Avoid destructive migrations.)

- `checkSeatExpansion` — deleted (no caller).
- `runDowngradeEnforcementPass` and its cron wiring — deleted.
- `FamilySubscription.pendingDowngradeTierKey`, `pendingDowngradeSeatCount`, and `downgradeGraceEndsAt` — **kept as dormant columns**. Mark them deprecated. This slice does no destructive migration now. The tier-downgrade billing endpoint (`billing.ts`) stops the writes to them and no longer schedules a suspension. It still changes the tier and price.
- The manual `expandSeats` endpoint (`billing.ts`) becomes vestigial, because seats auto-track. **Keep it in place. The add flow no longer needs it.** The removal is optional cleanup and is out of scope here.
- `PricingTier.activeUserLimit` — no longer gates an add. Kept as a column. The new coverage and billing path does not use it.

## 9. Isolation / correctness invariants

- Reconciliation touches only a family's **own** subscription and Stripe objects. It has no cross-tenant surface.
- The daily pass is **idempotent** and **non-fatal per family**. One Stripe failure logs an error and the pass continues.
- The system derives coverage live and never materializes it. This principle does not change.
- Reconciliation skips free-tier and non-entitling families. It never bills them.

## 10. Testing

- `entitlements.test.ts`: a paid family with N active members covers **all** N, with no cap. A free tier covers none. A suspended member is not covered. A TRIALING subscription covers.
- `reconcileSeats`: it sets `seatCount = activeCount`. It computes `desiredQty = max(0, activeCount - includedSeats)`. It calls Stripe **only when the quantity differs** (mock, assert `proration_behavior: "create_prorations"`). It is a no-op on a free or non-entitling family. It is idempotent (a second run makes no Stripe call).
- `runSeatReconciliationPass`: it iterates entitling subscriptions. One family that throws an error does not abort the rest.
- `families.ts` add: no 402 and no Stripe call on a member add (the mock asserts that the code never calls Stripe).
- `billingImpactForAdd`: true past `includedSeats` on a paid tier. False on a free tier or within the allowance.
- Regression: the existing billing and webhook tests stay green. This slice removes the downgrade-suspension tests with the pass.

## 11. Out of scope

- W1 PR-2 consent flows (a separate PR. This slice lands first.)
- The removal of the vestigial `expandSeats` endpoint or the dormant `pendingDowngrade*` columns (optional cleanup for later).
- Any UI (billing-impact notice delivery, billing settings copy) — for later.
- Changes to tiers, prices, trial logic, or the entitlement daily-limit constants.
