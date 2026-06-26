# FamLink — Agent Rules (shared process truth)

**Canonical, tool-agnostic process rules for ALL agent-assisted development on FamLink** (Claude Code, Codex, or any other agent). `AGENTS.md` and `CLAUDE.md` are thin adapters that point here and add only tool-specific behavior — they must not duplicate or override these rules. Dynamic phase/status lives in `docs/FamLink_Current_State.md`. **If anything here conflicts with the live code, trust the code** and update these docs.

> Guidelines bias toward caution over speed — for trivial tasks, use judgment.

---

## Working Style

**Give candid, evidence-based assessments. No cheerleading.** Push back when warranted — on Steve's ideas, on the plan, on the code. Surface risks, tradeoffs, and contrary evidence plainly rather than affirming. Ground opinions in the code, the docs, or named precedent; distinguish fact from judgment; say so when something is unknown rather than guessing. Praise only what is genuinely earned, and keep it brief. Steve has explicitly asked to be told when he is wrong.

---

## Repository Organization

**Keep everything committed and organized at all times.**
- Doc files, session bookmarks, ADR updates, and prompt libraries go in `/docs` — commit them in the same session they are created.
- Never leave untracked files sitting in the working tree between sessions. If a file exists, it should either be committed or gitignored.
- `packages/db/apps/` is a generated artifact directory — gitignored, do not commit.
- `.claude/worktrees/` and `.claude/settings.local.json` are gitignored (per-machine / scratch) — do not commit.
- All new documents are `.md` format — no Word docs.
- Documents are created by the agent, downloaded by Steve, placed in `/docs` manually.

---

## Development Rules

- **Commit format:** `feat: P<phase>-XX <short description>` (or `chore:` / `fix:` as appropriate). The active phase tag is recorded in `docs/FamLink_Current_State.md` (currently **P3-03**).
- **Governing document:** ADR v0.4 (`docs/FamLink_ADR_v0_4.md`) — consult before any architectural decision.
- **No decisions are locked until explicitly confirmed by Steve.**
- **Verification before "done":** run the relevant tests/lint/typecheck and show output before claiming work complete. The API CI lint step (`eslint src`) fails on any error — run lint, not just `tsc`, before pushing.

---

## Phase Completion Gate

**Do not advance to the next plan or phase until all known open items in the current plan are resolved.**

Before proposing or starting any new plan:
1. Read `docs/FamLink_Current_State.md` (and the most recent tool-private session bookmark, if any).
2. List every item marked incomplete, blocked, or deferred.
3. Surface those items to Steve explicitly: *"Before moving to P3-XX, these items from P3-YY are unresolved: [list]. Should we close them first?"*
4. Do not proceed until Steve either closes the items or explicitly defers them with a written decision.

Applies to: missing pages, unwired UI components, broken links, deferred integrations, and anything flagged "future work" or "follow-on."

---

## Session Scope Authorization

**Do not execute beyond what Steve authorized at session start.** When Steve authorizes a specific scope (e.g., "execute Tasks 1–5 of Plan A"), that scope is the ceiling. After the last authorized task:
1. Stop. Do not start the next plan, phase, or unrelated task.
2. Write the session checkpoint (below).
3. If the plan has remaining tasks, name them explicitly so Steve knows where to resume.

If scope is ambiguous ("let's do P3"), clarify the boundary before starting. Do not interpret ambiguity as unlimited authorization.

---

## Session Checkpointing (cross-tool)

**Every session must end in a resumable state, readable by any agent.**

1. **`docs/FamLink_Current_State.md` is the canonical, cross-tool resume point.** When meaningful work is done, update it (status, work completed + commit SHAs, verification baseline, next step, blockers, deferred items, GitNexus freshness) and **commit it**.
2. **Tool-private memory is supplementary, not canonical.** A given agent may keep its own notes (e.g., Claude Code's auto-memory `MEMORY.md` + memory dir). These supplement but never override `FamLink_Current_State.md`; if they conflict, the shared doc + the code win.
3. **No untracked files** — every file touched must be committed or gitignored before closing.

At session start, read `docs/FamLink_Current_State.md` (and your tool-private bookmark if you keep one) to resume without re-asking Steve for context.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.** Before implementing:
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**
- No features beyond what was asked; no abstractions for single-use code; no unrequested "flexibility."
- No error handling for impossible scenarios. Validate at system boundaries only — trust internal code and framework guarantees.
- If you write 200 lines and it could be 50, rewrite it. Three similar lines beat a premature abstraction.
- Ask: *"Would a senior engineer say this is overcomplicated?"* If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**
- Don't "improve" adjacent code/comments/formatting; don't refactor what isn't broken; match existing style.
- If you notice unrelated dead code, mention it — don't delete it. Read files before editing them. Prefer editing existing files over creating new ones.
- Remove imports/vars/functions YOUR changes made unused; don't remove pre-existing dead code unless asked.
- The test: *every changed line should trace directly to the user's request.*

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.** Transform tasks into verifiable goals ("add validation" → "write tests for invalid inputs, then make them pass"). For multi-step tasks, state a brief plan with a verify-check per step. Strong success criteria enable independent looping.

## 5. Security

- Do not introduce security vulnerabilities (injection, XSS, cross-tenant leakage, etc.).
- Do not add features, refactoring, or comments beyond what was asked.
- Cross-tenant isolation is a hard invariant (see ADR + the W3a isolation rules): never leak another family's name/roster/events/IDs across the `FamilyGroup` boundary.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
