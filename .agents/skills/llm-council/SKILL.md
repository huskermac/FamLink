---
name: llm-council
description: Use when a non-trivial Goal mode task needs an independent cross-model review of its implementation plan and verified delivery before Codex proceeds or declares completion.
---

# LLM Council

Keep Codex as the host and sole implementer. Use Claude only as an independent,
read-only reviewer.

Resolve `scripts/review.ps1` relative to this skill directory. From PowerShell,
pipe each review packet to:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<resolved-script-path>"
```

The per-process bypass is required on Windows systems that block direct `.ps1`
execution; it does not change the machine policy. Do not include secrets,
credentials, or unrelated private data.

## Plan gate

Before editing implementation files:

1. Inspect enough project context to produce a grounded plan.
2. Prepare a packet containing:
   - Goal and definition of done
   - Applicable project constraints
   - Assumptions and unresolved uncertainties
   - Proposed implementation plan
   - Expected files to change
   - Verification strategy
3. Run the reviewer.
4. Verify each `BLOCKER`, revise the plan for open blockers, and rerun the
   review when needed.
5. Begin implementation when no open `BLOCKER` findings remain.

## Delivery gate

After implementation and local verification:

1. Prepare a packet containing:
   - Original goal
   - Accepted plan
   - Changed files and material diff
   - Commands run and their results
   - Known limitations or risks
2. Run the reviewer.
3. Verify each `BLOCKER` independently, make necessary corrections for open
   blockers, rerun local verification, and request another review when needed.
4. Declare the goal complete when no open `BLOCKER` findings remain.

## Boundaries

- You own the verdict, not the reviewer. `MAJOR`, `MINOR`, and `NIT` findings do
  not block; apply the ones worth applying and move on.
- A `BLOCKER` you believe is wrong is not binding. State why you disagree. If
  disagreement remains about whether it blocks, escalate to the user instead
  of looping.
- Limit each gate to two review rounds. After a re-review, check convergence. If
  the new findings are strictly lower-severity than the previous round (for
  example, `BLOCKER` findings become only `MINOR` or `NIT` findings), stop and
  proceed.
- Always surface the reviewer's notes to the user. Never silently absorb or
  discard them.
- If the reviewer fails or returns malformed output, stop the gate and report
  the unresolved issue. Never silently bypass the reviewer.
- Treat reviewer notes as advice, not authority. Validate every claim before
  changing the repository.
- Do not let council feedback expand the user's requested scope.
