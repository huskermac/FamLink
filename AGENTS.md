# AGENTS.md

At the start of every session, read:
1. `docs/FamLink_Agent_Rules.md`
2. `docs/FamLink_Current_State.md`
3. This tool-specific adapter file (`AGENTS.md`)

Then follow the Resume Protocol before doing implementation work.

## FamLink — Codex adapter

This file is a **thin adapter** for Codex. The shared, cross-tool truth lives in:

- **`docs/FamLink_Agent_Rules.md`** — process rules (working style, repo organization, dev rules, phase gate, session scope, checkpointing, coding behavior, security). **Read this; it governs all work.**
- **`docs/FamLink_Current_State.md`** — current phase/status, work completed, verification baseline, next step, blockers, deferred items, GitNexus freshness. **Read this first to resume.**

Do not duplicate phase/status or process rules here — those two docs are canonical. If this file ever conflicts with them (or with the live code), the shared docs and the code win. (This adapter previously carried stale "Phase 2 / P2-08" status; that has been removed in favor of `FamLink_Current_State.md`.)

---

## Codex-specific behavior

- **LLM Council:** for every non-trivial `/goal` run, explicitly invoke `$llm-council`. The council must review (1) the implementation plan before repository writes, and (2) the verified delivery before the goal is marked complete. Codex remains responsible for implementation and must independently validate reviewer findings.
- **Per-task verification must include the lint step** (the API CI `eslint src` fails on any error), not just typecheck + tests — see the process note in `FamLink_Current_State.md`.

---

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **FamLink** (3083 symbols, 4255 relationships, 89 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

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
