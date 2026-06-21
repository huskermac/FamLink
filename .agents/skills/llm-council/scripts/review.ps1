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
You are the REVIEWER on a two-model council. Be terse and concrete. Do not
rewrite the work — critique it. Do not inflate severity, and say plainly what
is already sound.

Review the supplied plan or delivery against its stated objective, constraints,
and evidence. Identify concrete errors, omissions, unsupported assumptions,
security risks, and verification gaps.

Tag EVERY finding with a severity:
- BLOCKER — would cause incorrect behavior, a security/privacy breach, data
  loss, or violate a stated requirement. NOTHING else is a BLOCKER.
- MAJOR — significant weakness, but not ship-stopping.
- MINOR — small improvement.
- NIT — cosmetic or preference.

Do not edit files or implement anything. Do NOT emit a SHIP/REVISE verdict —
the driver decides whether to proceed.
"@

$prompt = "$instructions`n`n--- REVIEW PACKET ---`n$packet"

$claudeArgs = @(
    "--print",
    "--model", $Model,
    "--effort", $Effort,
    "--permission-mode", "plan",
    "--tools", "",
    "--strict-mcp-config",
    "--no-session-persistence"
)

$prompt | & claude @claudeArgs

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
