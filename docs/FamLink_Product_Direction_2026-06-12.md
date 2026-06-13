# FamLink — Product Direction Note

*2026-06-12 · strategic addendum, not a locked plan. Captures business-case discussion held the day production went live. Supplements (does not replace) the PRD and ADR.*

This note records product-strategy ideas evaluated with Steve and the reasoning behind keeping, shaping, or rejecting each — so future planning starts here instead of re-deriving it. **These are directions, not committed scope.** Nothing here is a locked decision until Steve confirms it in a plan.

---

## The two structural risks everything is measured against

Family-coordination products have a large graveyard (Cozi, FamilyWall, Picniic, Path, Google+ Family, Honeycomb, Hubz, …). They rarely failed for lack of a real problem. They failed on:

1. **Cold start / empty-graph** — a coordination platform is worthless until enough of *your specific group* is on it. FamLink's guest-participation (no-account RSVP) is the right instinct and is built — it solves *participation* but not *retention*.
2. **Frequency** — a tool used 4–6×/year (big events) can't build habit, justify a subscription in the user's mind, or generate engagement data. **This is the primary killer**, and most of the ideas below are judged by whether they raise frequency.

**The franchise to protect:** the family relationship graph + privacy/trust. The graph is the only thing Google Calendar / group texts structurally can't clone; trust is the post-Facebook wedge. Every idea is scored by whether it *compounds* or *spends* these.

---

## Ideas — verdicts

### ✅ KEEP & PRIORITIZE — Daily-life event surface (all event types)
Track *everything*, not just big events: youth sports, recitals, practices, church events, school calendars, birthdays. **Directly attacks the frequency risk** — moves FamLink from 4–6×/year to weekly/daily touch. Highest-leverage idea on the list.
- **Shape:** make ONE recurring behavior sticky first — the weekly "what's coming up across your people" view/digest — before building twelve event types. Resist everything-app bloat.
- **Leverage existing plan:** structured sports/school schedule *import* (already deferred to Phase 3 in PRD/ADR-10 era docs) is the right mechanism — pull the data, don't make Organizers hand-enter practice schedules (that recreates the burden being removed).

### ✅ KEEP & PRIORITIZE — AI-forward, natural-language-first UX
Move beyond forms/"next" buttons; make the assistant the primary interface ("set up Thanksgiving Saturday 6pm at Mom's and invite the cousins"). This is the strongest differentiator AND the most credible retention hook (forms don't make anyone return; a capable assistant might). Aligns with Layer 2/3 roadmap (P3-02+).
- **Hard constraint — do not lose:** the Grandparent / Reluctant-Member personas are the whole adoption thesis, and NL-first can be *harder* for them, not easier. NL must be **additive (the Organizer's fast path), not a replacement** — preserve simple tap-targets and one-click RSVP. Leading with AI must not delete the accessible path.
- **Sequencing note:** design Layer 2's AI budget **per-family, not per-user-query** (the 20/user/day model doesn't fit proactive triggers). Already on the M3/P3-02 list.

### 🟡 SHAPE — Expand beyond family groups (do the deep-vertical version, NOT horizontal)
The general "any group: churches, clubs, associations" idea is a genuine fork that cuts both ways:
- **Horizontal "any group" — RESIST pre-traction.** It dissolves the moat (a generic group is a roster, not a relationship graph) and walks into bloodier, occupied competition: Band, GroupMe, Discord (general); TeamSnap / Heja / SportsEngine (youth sports); Planning Center / Subsplash (church); Slack/Microsoft (professional). Trades a sharp emotional pitch for a generic one investors have heard a hundred times. This is a **Series-A pivot to consider after winning families**, not pre-seed scope.
- **Deep-vertical — PURSUE.** Enter youth sports **as a family feature** ("add Emma's soccer team") rather than a generic groups product. Family-adjacent (parents are already users), high-frequency, acute pain — captures most of the frequency upside while keeping the family graph as the spine and the family pitch intact. The **Co-Parent / divorced-family** segment is also worth hard evaluation as a sharper beachhead than the general Organizer (custody schedules are weekly, pain is acute, willingness to pay is higher).

### ❌ REJECT — Selling the underlying data
Strategically self-contradictory; advised against. It detonates the exact asset (privacy/trust) that is the core differentiator and the reason families leave Facebook. The data is uniquely radioactive (family relationships, children's schedules, locations, religious affiliation via church groups, minors → COPPA/GDPR, already a pre-launch legal blocker in the ADR). Economics don't justify the risk (low-margin brokerage, tightening law). **The clean version of this idea already exists and is the PRD's actual primary thesis: affiliate commerce** — monetize the *intent* the data reveals (gifts, travel, catering, venues around coordinated events) without selling the data. Same asset, opposite trust outcome, bigger upside. Put the energy there.

---

## Monetization reality (carried from the business-case discussion)
- Subscriptions for a low-frequency family utility are a historically hard sell (low ARPU, churn when perceived value lapses between events). Treat the shipped subscription as **table-stakes / validation revenue**, not the venture thesis.
- **Affiliate commerce is the actually-interesting business and is currently unbuilt.** A family coordinating a reunion has high purchase intent (gifts, flights, catering, venue). Owning that coordination context makes an affiliate take natural and large. **Test it early and cheaply** — even a crude "add a gift to this birthday" Amazon affiliate link is a higher-value signal than more billing features.

## The one thing that decides viability
Not technical, not answerable from the code: **will a real Organizer, with her real family, still open FamLink in week 6 when no event is on the calendar?** Everything rides on it. The biggest current gap to a fundable narrative is **zero real-usage data**. Priority over new features: get 5–10 real families on it (Steve is himself a real Organizer with a real extended family — dogfood it this holiday season) and instrument the PRD's retention metrics (D30 family retention ≥40%, MAF ≥60%) ruthlessly. Don't out-build the validation — the comfortable work is building; the uncomfortable, decisive question is whether families use and pay.

---

## How these change the overall opinion
- Ideas 1 (daily-life surface) and AI-forward UX **strengthen the case** — together the most credible answer to the frequency/retention risk.
- "Expand beyond family" is a **fork**: deep-vertical (sports as a family feature) is among the best growth ideas; horizontal "any group" trades the moat for a knife fight — resist pre-traction.
- Selling data **subtracts** — it cannibalizes the trust that makes everything else worth anything.
- Through-line: **everything good compounds the family-trust-graph; the rejected idea spends it. Protect the trust and the graph — they are the franchise.**
