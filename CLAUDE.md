# CLAUDE.md
## FamLink Project Instructions + General Coding Behavior

These instructions govern all Claude-assisted development on this project.
Guidelines bias toward caution over speed — for trivial tasks, use judgment.

---

## Repository Organization

**Keep everything committed and organized at all times.**
- Doc files, session bookmarks, ADR updates, and prompt libraries go in `/docs` — commit them in the same session they are created.
- Never leave untracked files sitting in the working tree between sessions. If a file exists, it should either be committed or gitignored.
- `packages/db/apps/` is a generated artifact directory — gitignored, do not commit.
- All new documents are `.md` format — no Word docs.
- Documents are created by Claude, downloaded by Steve, placed in `/docs` manually.

---

## Phase 2 Build Context

- **Current phase:** Phase 2 (P2-08 is next)
- **Test runner:** Vitest (API + web), Jest + Expo preset (mobile)
- **AI observability:** Helicone
- **Real-time:** Socket.io (`event:created`, `rsvp:updated` events)
- **Propose-confirm pattern:** All AI writes require human-in-the-loop confirmation

---

## Development Rules

- **Commit format:** `feat: P2-XX <short description>` (or `chore:`, `fix:` as appropriate)
- **Governing document:** ADR v0.4 (`docs/FamLink_ADR_v0_4.md`) — consult before any architectural decision
- **No decisions are locked until explicitly confirmed by Steve**

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
