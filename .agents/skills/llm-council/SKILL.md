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
4. For `VERDICT: REVISE`, verify each blocker, revise the plan, and rerun the
   review.
5. Begin implementation only after `VERDICT: PASS`.

## Delivery gate

After implementation and local verification:

1. Prepare a packet containing:
   - Original goal
   - Accepted plan
   - Changed files and material diff
   - Commands run and their results
   - Known limitations or risks
2. Run the reviewer.
3. For `VERDICT: REVISE`, verify each blocker independently, make the necessary
   corrections, rerun local verification, and request another review.
4. Declare the goal complete only after `VERDICT: PASS`.

## Boundaries

- Limit each gate to three review attempts.
- If the reviewer fails, returns malformed output, or still blocks after three
  attempts, stop the gate and report the unresolved issue. Never silently
  bypass the reviewer.
- Treat reviewer notes as advice, not authority. Validate every claim before
  changing the repository.
- Do not let council feedback expand the user's requested scope.
