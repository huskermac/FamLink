param(
    [string]$Model = "opus",
    [ValidateSet("low", "medium", "high", "xhigh", "max")]
    [string]$Effort = "high"
)

$pipelineInput = @($input)
$packet = if ($pipelineInput.Count -gt 0) {
    $pipelineInput -join [Environment]::NewLine
}
else {
    [Console]::In.ReadToEnd()
}

if ([string]::IsNullOrWhiteSpace($packet)) {
    throw "The review packet is empty."
}

$instructions = @"
You are the independent reviewer in an LLM council.

Review the supplied plan or delivery against its stated objective, constraints,
and evidence. Be skeptical but practical. Identify concrete errors, omissions,
unsupported assumptions, security risks, and verification gaps.

Do not redesign the work merely because you prefer another style.
Do not edit files or implement anything.

Return exactly:

VERDICT: PASS or REVISE

BLOCKERS:
- Only issues that must be resolved before continuing

NOTES:
- Non-blocking improvements, if any
"@

$prompt = "$instructions`n`n--- REVIEW PACKET ---`n$packet"

$claudeArgs = @(
    "--print",
    "--model", $Model,
    "--effort", $Effort,
    "--permission-mode", "plan",
    "--tools", "",
    "--no-session-persistence"
)

$prompt | & claude @claudeArgs

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
