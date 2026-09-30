# W1 PR-4 — Consent and Household Mobile UI (design spec)

Date: 2026-09-30. Phase: P3-04.

Parent spec: `docs/superpowers/specs/2026-07-14-w1-household-family-m2m-design.md`.
Web precedent: `docs/superpowers/specs/2026-08-28-w1-pr3-consent-household-web-ui-design.md`.
This spec covers the mobile UI only. It adds no API endpoint. It consumes the PR-2 API.

## 1. Goal

Give the mobile app the same Scope B surfaces that the web app shipped in PR-3. A family
admin can start a membership consent request. A signed-in counterparty can accept or
decline a request. A member can see the families that a household links to. An admin can
see the household audit and can unlink a family.

## 2. Locked decisions (Steve, 2026-09-30)

- **Scope matches web Scope B.** Ship the inbox, the unified add-member form, and the
  household linked-families, audit, and unlink section.
- **Household-link create stays deferred.** This PR does not add a control that creates a
  household link.
- **Onboarding consent routing stays deferred.** This PR does not change onboarding.
- **The public consent page stays on the web.** Mobile does not build a second
  `/consent/{token}` page. A person with no account still opens the web link.

## 3. Placement (proposed — confirm before implementation)

The mobile app has four tabs: Family, Events, Calendar, and Assistant. This PR does not
add a fifth tab.

- Put a **Requests** row at the top of the Family tab. The row shows a pending count.
  A tap opens a Requests screen on the Family stack.
- Put the **add-member** control on the Family tab, under the member list. Show it only
  when `useIsFamilyAdmin` is true for the family on screen.
- Put one **household section** under the member list for each household already returned
  by the family detail. The Family tab already loads that detail shape in
  `useFamily.ts`. This PR does not add a household picker.

The Family tab keeps its current rule: it uses the first membership from
`useMyFamilies`. This PR does not add a multi-family switcher.

## 4. API surface consumed (no change in this PR)

Use the same live routes as the web spec §3.

- `GET /api/v1/link-requests/pending`
- `POST /api/v1/link-requests/:id/accept` and `POST /api/v1/link-requests/:id/decline`
- `POST /api/v1/link-requests` with `familyGroupId` in the body
- `POST /api/v1/persons` and `POST /api/v1/families/:familyId/members`
- `GET /api/v1/households/:id`, `GET /api/v1/households/:id/audit`, and
  `POST /api/v1/households/:id/unlink`

The public consent token routes stay web-only.

## 5. Surfaces

### 5.1 Requests row and inbox

The Requests row shows the pending count from `GET /api/v1/link-requests/pending`. A zero
count hides the number. The count refreshes when the Family tab gains focus. It does not
poll in the background. This matches the web badge rule.

The inbox screen lists pending requests. Each row shows the requesting family name and a
purpose line. Use the same purpose rules as
`apps/web/app/(protected)/requests/page.tsx`:

- a household-link request names the household,
- a JOIN request names who asks to join,
- any other request names who the family asks to add.

Each row has Accept and Decline. When the request has `carryHouseholdName`, the row
also shows `Also adds you to the household: {name}.` A success refreshes the pending
list. A failure shows the fixed sentence `Something went wrong. Try again.` on that
row. The screen does not render a request id. The screen does not render API error
text. An empty list shows `You have no pending requests.`

### 5.2 Unified add-member

Match the web `AddMemberForm` rules.

- The control is admin-only.
- The form allows at most one contact: an email, a phone, or neither. It rejects an
  email and a phone together with `Enter an email or a phone, not both.`
- The date-of-birth field shows only on the no-contact path.
- The attestation control shows only when a contact is entered.
- When the family has a household, the form offers an optional control,
  `also add to household {name}`. The form sends `carryHouseholdId` on the link-request
  call only. The direct member-add path does not send it.
- A direct add that returns `409 CONSENT_REQUIRED` retries as a link request. The user
  sees the outcome, not the branch.
- Any other failure shows `Something went wrong. Try again.`

### 5.3 Household section

Match the web `HouseholdSection` rules.

- Every viewer sees the linked-family names.
- The audit query runs only for an admin. A non-admin does not send that request.
- The unlink control shows only for an admin. It calls `POST /api/v1/households/:id/unlink`.
  A `409 LAST_LINK` response asks the admin to confirm destroy. A confirm sends the
  same call with `destroy: true`.
- The screen shows names. It does not show another family's ids.

## 6. Out of scope

- A control that creates a household link.
- Onboarding consent routing.
- A mobile public consent page.
- Organizer skip-notices.
- A fifth tab, or a multi-family switcher.
- Any API or schema change.

## 7. Tests

Use the mobile Jest suite. Cover the inbox, the add-member form, and the household
section.

- An inbox fixture includes a foreign id. The render does not show that id. A request
  with `carryHouseholdName` shows the carry-household sentence.
- A linked-families fixture includes a foreign family id. The render shows the name and
  does not show that id.
- An audit fixture includes a foreign actor id. The render shows the display name and
  does not show that id.
- A failed Accept and a failed Decline show the fixed sentence and do not show API text.
- A non-admin does not see add-member, does not see unlink, and does not fire the audit
  query.
- An admin can start a link request after `CONSENT_REQUIRED`. The contact path sends
  `carryHouseholdId` only when the admin selected a household.
- A `409 LAST_LINK` unlink shows the destroy confirm. The confirm sends `destroy: true`.

## 8. Verification

From the repo root, run the mobile test script, `npm run type-check`, and `npm run lint`.
Lint must report 0 errors. This PR has no migration and no production data change.
