# CLAUDE.md
## FamLink Project Instructions + General Coding Behavior

These instructions govern all Claude-assisted development on this project.
Guidelines bias toward caution over speed — for trivial tasks, use judgment.

---

## Working Style

**Give candid, evidence-based assessments. No cheerleading.** Push back when warranted — on Steve's ideas, on the plan, on the code. Surface risks, tradeoffs, and contrary evidence plainly rather than affirming. Ground opinions in the code, the docs, or named precedent; distinguish fact from judgment; say so when something is unknown rather than guessing. Praise only what is genuinely earned, and keep it brief. Steve has explicitly asked to be told when he is wrong.

---

## Repository Organization

**Keep everything committed and organized at all times.**
- Doc files, session bookmarks, ADR updates, and prompt libraries go in `/docs` — commit them in the same session they are created.
- Never leave untracked files sitting in the working tree between sessions. If a file exists, it should either be committed or gitignored.
- `packages/db/apps/` is a generated artifact directory — gitignored, do not commit.
- All new documents are `.md` format — no Word docs.
- Documents are created by Claude, downloaded by Steve, placed in `/docs` manually.

---

## Current Phase

- **Phase 2:** COMPLETE (P2-00 through P2-13 + design polish, all shipped)
- **Current phase:** Phase 3 — P3-01 (billing) complete; **P3-00 (Privacy & Billing Integrity hardening) COMPLETE** (Milestones 0–3 all shipped 2026-06-18). M3 closed atomic AI rate-limit, server-side photo URLs + uploader-scoped R2 keys, guest-endpoint rate limiting, ADR reconciliation to v0.4.7, stray-png removal. "Family-scoped contact matching" was investigated and closed as a non-issue (membership gate makes it inert).
- **Ops baseline (2026-06-18):** dev/test DB on local Postgres 18 (Railway = prod-only); Railway Postgres password + GitHub PAT both rotated.
- **Backlog from M3 review:** (1) cross-family invitation visibility — **DEFERRED 2026-06-20**: blocked on a prerequisite contact-verification subsystem (verified flag + normalization + uniqueness on `Person` contacts); without it the council-reviewed design (`docs/FamLink_Design_Cross_Family_Invitation_Visibility.md` §3/§11) only ships token-only (a no-op). Build contact-verification before this feature. (2) person-photo URL trust — **DONE 2026-06-20** (commit `2409d4f`): person create/update no longer accept a client `profilePhotoUrl`; new `POST /persons/:personId/photo` derives the URL server-side from an uploader-scoped key.
- **Family-model reframe (P3-02/P3-03) — IN PROGRESS** (design council-converged: `docs/FamLink_Design_Family_Model_Reframe.md`). **Shipped & merged:** W2 per-person AI entitlement (P3-02, PR #1); W2b entitlement surfacing + foreign-context throttle + mobile upsell (PR #2); W3a-API cross-family event participation — EventParticipant grant/roles, resolveEventAccess, invite/accept/revoke, participant RSVP+tasks, ForeignInvitedEventDTO (P3-03, PR #3). **Sequenced next (specs+plans written, NOT yet executed):** (1) **Contact Identity Foundation** — Plan A backbone (`docs/superpowers/plans/2026-06-25-contact-identity-foundation-a-backbone.md`) then Plan B merge; (2) **W3a-UI-web** (`docs/superpowers/specs/2026-06-25-w3a-ui-web-...`); (3) W3a-UI-mobile; (4) rest of **W3b** (passive SMS onboarding + inbound webhook); (5) **W4** Pro Organizer; (6) **W1** Household reframe. Older P3 ideas (Image Pipeline, Group Chat, Layer-3 AI) re-sequenced behind the reframe.
- **Test runner:** Vitest (API + web), Jest + Expo preset (mobile)
- **AI observability:** Helicone
- **Real-time:** Socket.io (`event:created`, `rsvp:updated` events)
- **Propose-confirm pattern:** All AI writes require human-in-the-loop confirmation

---

## Development Rules

- **Commit format:** `feat: P3-XX <short description>` (or `chore:`, `fix:` as appropriate)
- **Governing document:** ADR v0.4 (`docs/FamLink_ADR_v0_4.md`) — consult before any architectural decision
- **No decisions are locked until explicitly confirmed by Steve**

---

## Phase Completion Gate

**Do not advance to the next plan or phase until all known open items in the current plan are resolved.**

Before proposing or starting any new plan (P3-02, P3-03, etc.):
1. Read the most recent session bookmark in memory.
2. List every item marked as incomplete, blocked, or deferred in that bookmark.
3. Surface those items to Steve explicitly: *"Before moving to P3-XX, these items from P3-YY are unresolved: [list]. Should we close them first?"*
4. Do not proceed until Steve either closes the items or explicitly defers them with a written decision.

This applies to: missing pages, unwired UI components, broken links, deferred integrations, and anything flagged as "future work" or "follow-on" in a plan or session bookmark.

---

## Session Scope Authorization

**Do not execute beyond what Steve authorized at session start.**

When Steve authorizes a specific scope — e.g., "execute Tasks 1–5 of P3-01" or "run the P3-01 plan" — that scope is the ceiling for the session. After completing the last authorized task:

1. Stop. Do not start the next plan, phase, or unrelated task.
2. Write the session progress summary (see below).
3. If the plan has remaining tasks, name them explicitly so Steve knows exactly where to resume.

If scope is ambiguous (e.g., "let's do P3"), clarify the boundary before starting: which plan(s), which tasks, which phase items. Do not interpret ambiguity as unlimited authorization.

---

## Session Checkpointing

**Every session must end in a resumable state.** At the close of any session where meaningful work was done:

1. **Update this file** — If the current phase or "what's next" has changed, update the "Current Phase" section above and commit the change.

2. **Write a detailed session progress summary to auto-memory** — Save a memory file at `C:\Users\swmcl\.claude\projects\c--Users-swmcl-FamLink\memory\project_session_bookmark_YYYY-MM-DD.md` covering:
   - **Authorized scope** — what Steve asked for this session
   - **Completed tasks** — task name, commit SHA, brief description of what changed
   - **Incomplete tasks** — what was NOT done, and why (if applicable)
   - **Next authorized step** — the exact task name/number to resume from
   - **Open questions or blockers** — anything that needs Steve's decision before work can continue
   - **Design decisions made** — any choices made during implementation that aren't obvious from the code

3. **Update `MEMORY.md`** — Add a one-line pointer to the new bookmark at the top of the index.

4. **No untracked files** — Every file touched this session must be committed or gitignored before closing.

**At the start of each session**, read `MEMORY.md` to locate the most recent session bookmark and use it to resume without asking Steve to re-explain context. If something in the bookmark conflicts with the current code, trust the code and update the memory.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

---

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- Validate at system boundaries only — trust internal code and framework guarantees.
- If you write 200 lines and it could be 50, rewrite it.
- Three similar lines of code is better than a premature abstraction.

Ask yourself: *"Would a senior engineer say this is overcomplicated?"* If yes, simplify.

---

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- Read files before editing them.
- Do not create files unless absolutely necessary — prefer editing existing files.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: *Every changed line should trace directly to the user's request.*

---

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria enable independent looping. Weak criteria ("make it work") require constant clarification.

---

## 5. Security

- Do not introduce security vulnerabilities (injection, XSS, etc.)
- Do not add features, refactoring, or comments beyond what was asked.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
