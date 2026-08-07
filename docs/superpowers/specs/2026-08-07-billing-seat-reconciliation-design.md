# Billing — Usage-Based Seat Reconciliation (design spec)

| Field | Value |
|---|---|
| Date | 2026-08-07 (brainstormed with Steve; decisions locked in-session) |
| Phase | P3-04 (billing slice enabling W1 PR-2 consent flows) |
| Origin | W1 spec §2 **decision 10** (2026-08-07): "seat billing is decoupled from consent and reconciled from actual membership." This spec is that slice. |
| Status | Awaiting Steve spec review → writing-plans |
| Sequencing | **Lands BEFORE W1 PR-2.** PR-2 then simply adds members and never calls Stripe. |

## 1. Goal

Remove seat billing from the member-add / consent hot path. A member is added with **no inline Stripe call and no blocking seat confirmation**; they are **covered immediately** (AI/paid features work at once); the family's Stripe seat quantity is **reconciled from the true active-member count by a daily job**, so the next invoice reflects reality. This eliminates the request-time-vs-accept-time staleness, the Stripe-after-commit failure window, and the deadlock the W1 PR-2 council round-2 review identified — while avoiding surprise instant charges.

## 2. Locked decisions (Steve, 2026-08-07)

1. **Adding a member never calls Stripe and never blocks on billing.** The 402 "confirm seat expansion" gate on add is removed.
2. **Coverage is immediate and cap-free.** A person is covered iff they are an active (non-suspended) member of ≥1 **paid, entitling** family (`status ∈ {ACTIVE, TRIALING}` and `PricingTier.stripePriceId != null`). The `take: seatCount` entitlement cap in `entitlements.ts` is **removed**. `seatCount` stops being an entitlement cap and becomes purely the **billing quantity** the reconciliation maintains.
3. **Billing is reconciled from actual membership by the daily cron** (arrears / next-cycle). No per-membership-change Stripe calls.
4. **Seat-based member suspension is retired.** With seats = headcount there is no "over the limit," so the downgrade-grace suspension pass and the `pendingDowngrade*` machinery are retired. A tier downgrade changes price/features but never auto-suspends members.
5. **The admin is notified their bill will change** when an add raises billable headcount (surfaced as an API response indicator in this slice; richer delivery is UI-layer work later).

## 3. Coverage model change (`apps/api/src/lib/entitlements.ts`)

`isPersonCoveredByFamily` today loads active members `orderBy joinedAt take: seatCount` and checks membership in that seated set. **Change:** drop the `take: seatCount` seat-boundary entirely. Coverage becomes:

```
covered-by-family(person, family) :=
  sub exists
  AND sub.status ∈ {ACTIVE, TRIALING}
  AND sub.pricingTier.stripePriceId != null   // free tier never covers
  AND person is an active (suspendedAt == null) FamilyMember of family
```

No seat-ordering query, no cap. `isPersonCovered`, `getAiDailyLimit*`, and `getAiEntitlementForUser` are unchanged in shape — they inherit the new definition. The AI daily-limit constants and foreign-context logic are untouched.

## 4. Add path change (`apps/api/src/routes/families.ts`)

`POST /:familyId/members`:
- Delete the entire `if (targetPerson.userId) { checkSeatExpansion … Stripe … }` block (the 402 gate + inline Stripe seat update).
- The member is created unconditionally (subject to the existing authz + the W1 PR-2 provenance/consent gate, which lands in PR-2 — **this slice leaves the add path otherwise intact**).
- **Note:** direct-add targets after W1 PR-2 are *passive, no-contact* records (`userId == null`) — which never affect billing anyway (billing counts `userId != null` active members). So in practice the billing-impact notice belongs to the **consent-accept** path (PR-2) and **CIF activation**, not to this slice's direct-add. This slice provides the notice helper; PR-2 calls it.

`checkSeatExpansion` (`lib/subscriptionEnforcement.ts`) is **deleted** (no remaining caller after this slice). `applySeatIncrement` (introduced in the PR-2 round-2 plan) is **not created** — superseded by `reconcileSeats`.

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
      upsert the seat line item to desiredQty with proration_behavior: "none"
```

- **`proration_behavior: "none"`** (recommended — **flag for Steve's spec review**): the new quantity takes effect at the **next billing cycle**; no mid-cycle proration line items, no instant charge. Members added mid-cycle are covered immediately and billed from the next cycle. *Alternative:* `"create_prorations"` bills the partial period at the next invoice (truer arrears, but adds proration line items). Recommendation is `"none"` for predictability and simplicity at current scale.
- **Idempotent** (sets an absolute quantity; the `currentQty != desiredQty` guard makes re-runs no-ops).
- Absolute-quantity is the same math already in `billing.ts`/`families.ts` today (`max(0, seats - includedSeats)`), so the Stripe interaction pattern is unchanged — only its *trigger* moves to the cron.

## 6. Daily job (`apps/api/src/jobs/billingEnforcement.ts`)

- **Add** `runSeatReconciliationPass()`: iterate entitling subscriptions, call `reconcileSeats(familyGroupId)` for each (guarded per-family so one Stripe error doesn't abort the pass). Wire it into the existing `startBillingCron` 06:00 UTC schedule alongside `runTrialWarningPass`.
- **Remove** `runDowngradeEnforcementPass()` (the seat-based member-suspension pass) and its cron wiring (decision 4). Keep `runTrialWarningPass()`.
- The `customer.subscription.updated` webhook handler (`routes/webhooks.ts`) stays as the local-`seatCount` convergence backstop; confirm it still sets `seatCount` from the Stripe quantity (no change expected).

## 7. Billing-impact notice (helper this slice provides, PR-2/CIF consume)

`billingImpactForAdd(familyGroupId): Promise<{ willBill: boolean; note: string | null }>` — returns whether adding one active member would raise billable headcount beyond `includedSeats` on a paid tier, and a plain-language note ("This will be reflected on your next invoice."). This slice defines and unit-tests the helper; **W1 PR-2's accept path returns it in the response**, and it may be surfaced at CIF activation. No new delivery channel is built here.

## 8. Retired / vestigial (call out in the plan; avoid destructive migrations)

- `checkSeatExpansion` — deleted (no caller).
- `runDowngradeEnforcementPass` + cron wiring — deleted.
- `FamilySubscription.pendingDowngradeTierKey` / `pendingDowngradeSeatCount` / `downgradeGraceEndsAt` — **left as dormant columns** (documented deprecated; no destructive migration now). The tier-downgrade billing endpoint (`billing.ts`) stops writing them / no longer schedules suspension; it still changes tier/price.
- The manual `expandSeats` endpoint (`billing.ts`) becomes vestigial (seats auto-track). **Leave it in place but no longer required by the add flow;** removal is optional cleanup, out of scope here.
- `PricingTier.activeUserLimit` — no longer gates adds. Left as a column; unused by the new coverage/billing path.

## 9. Isolation / correctness invariants

- Reconciliation only ever touches a family's **own** subscription and Stripe objects — no cross-tenant surface.
- The daily pass is **idempotent** and **non-fatal per family** (one Stripe failure logs and continues).
- Coverage is derived live (never materialized) — unchanged principle.
- Free-tier and non-entitling families are skipped by reconciliation (never billed).

## 10. Testing

- `entitlements.test.ts`: a paid family with N active members covers **all** N (no cap); free tier covers none; suspended member uncovered; TRIALING covers.
- `reconcileSeats`: sets `seatCount = activeCount`; computes `desiredQty = max(0, activeCount - includedSeats)`; calls Stripe **only when quantity differs** (mock, assert `proration_behavior: "none"`); no-op on free/non-entitling; idempotent (second run no Stripe call).
- `runSeatReconciliationPass`: iterates entitling subs; one throwing family doesn't abort the rest.
- `families.ts` add: no 402, no Stripe call on member-add (mock asserts Stripe never invoked).
- `billingImpactForAdd`: true past `includedSeats` on a paid tier; false on free tier / within allowance.
- Regression: existing billing/webhook tests stay green; downgrade-suspension tests are removed with the pass.

## 11. Out of scope

- W1 PR-2 consent flows (separate PR; this lands first).
- Removing the vestigial `expandSeats` endpoint / dropping the dormant `pendingDowngrade*` columns (optional later cleanup).
- Any UI (billing-impact notice delivery, billing settings copy) — later.
- Changing tiers, prices, trial logic, or the entitlement daily-limit constants.
