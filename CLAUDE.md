# CLAUDE.md

At the start of every session, read:
1. `docs/FamLink_Agent_Rules.md`
2. `docs/FamLink_Current_State.md`
3. This tool-specific adapter file (`CLAUDE.md`)

Then follow the Resume Protocol before doing implementation work.

## FamLink — Claude Code adapter

This file is a **thin adapter** for Claude Code. The shared, cross-tool truth lives in:

- **`docs/FamLink_Agent_Rules.md`** — process rules (working style, repo organization, dev rules, phase gate, session scope, checkpointing, coding behavior, security). **Read this; it governs all work.**
- **`docs/FamLink_Current_State.md`** — current phase/status, work completed, verification baseline, next step, blockers, deferred items, GitNexus freshness. **Read this first to resume.**

Do not duplicate phase/status or process rules here — those two docs are canonical. If this file ever conflicts with them (or with the live code), the shared docs and the code win.

---

## Claude-Code-specific behavior

- **Auto-memory is supplementary, not canonical.** Claude's auto-memory index (`MEMORY.md`) and session bookmarks under `C:\Users\swmcl\.claude\projects\C--Users-swmcl-FamLink\memory\` are private working notes. They supplement `docs/FamLink_Current_State.md` but never override it. When checkpointing, update `docs/FamLink_Current_State.md` (the shared resume point) **and** commit it; keep auto-memory in sync but treat the committed doc as source of truth.
- **Skills:** superpowers skills (brainstorming → writing-plans → subagent-driven-development / executing-plans, codex-review for council gates) are the standard workflow for non-trivial work. Use them.
- **Per-task verification must include `npm run lint`** (not just `tsc` + tests) — see the process note in `FamLink_Current_State.md`; an eslint-only error once broke CI.
- **Simplified Technical English (STE):** For all FamLink written deliverables, Steve needs ASD-STE100 STE (see `docs/FamLink_Agent_Rules.md`). Invoke the `anthropic-skills:ste` skill before you write a deliverable. Write specs, plans, docs, the state document and checkpoints, and commit and pull-request messages to the STE rules. Chat replies to Steve stay conversational.

---

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **FamLink** (2805 symbols, 4498 relationships, 116 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/FamLink/context` | Codebase overview, check index freshness |
| `gitnexus://repo/FamLink/clusters` | All functional areas |
| `gitnexus://repo/FamLink/processes` | All execution flows |
| `gitnexus://repo/FamLink/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
