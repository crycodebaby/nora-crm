# Atomic Contact Primary Intent — CROSS-COMMAND real-session concurrency
# matrix (local only).
#
# The new-vs-new matrix lives in contact_primary_intent_concurrency_runner.ps1.
# THIS runner exists because the independent RC review (2026-09-08) found a
# release-blocking lock-order inversion that new-vs-new races could not catch:
# the pre-existing Quick Capture / create_customer_with_contact core wrote the
# contact row BEFORE it touched the customer row, the exact inverse of
# nora_private.prepare_primary_contact_slot.
#
#   X-A  Quick Capture (existing customer, contact primary)  vs  update_contact make_primary
#   X-B  Quick Capture (existing customer, contact primary)  vs  set_primary_contact
#   X-C  Quick Capture (existing customer, contact primary)  vs  create_contact make_primary
#   X-D  create_customer_with_contact (moves an existing contact) vs primary transition on the SOURCE customer
#   X-E  update_contact move source->target                  vs  primary transition on the SOURCE customer
#   X-F  update_contact move source->target                  vs  primary transition on the TARGET customer
#
# Every scenario runs -Rounds times against its OWN fresh pair of customers, so
# repeated races are independent and a single lucky execution proves nothing.
#
# Usage (from the repo root, after `npx supabase db reset --local`):
#   powershell -ExecutionPolicy Bypass -File supabase/tests/contact_primary_cross_command_runner.ps1
#   powershell -ExecutionPolicy Bypass -File supabase/tests/contact_primary_cross_command_runner.ps1 -Rounds 15
#
# Never point this at Production. It leaves the two fixture sales rows behind
# (the W6-B guard forbids deleting sales rows); contacts/companies are removed.

param(
    [int]$Rounds = 8,
    [string]$Container = "supabase_db_atomic-crm-demo"
)

$ErrorActionPreference = "Stop"
$tests = $PSScriptRoot
$scenarios = @("X-A", "X-B", "X-C", "X-D", "X-E", "X-F")

function Invoke-Psql([string]$file, [string[]]$vars) {
    $a = @("exec", "-i", $Container, "psql", "-U", "postgres", "-d", "postgres", "-q")
    foreach ($v in $vars) { $a += @("-v", $v) }
    $a += @("-f", "-")
    Get-Content -Raw $file | & docker @a
}

# UTC unix epoch (PowerShell 5.1 "%s" is offset by the local timezone — never use it here)
function Fire-At([double]$seconds) { return ([double][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0) + $seconds }

function Start-Worker([string]$scenario, [string]$role, [int]$round, [double]$fireAt) {
    $file = Join-Path $tests "contact_primary_cross_command_worker.sql"
    $vl = @("scenario=$scenario", "role=$role", "round=$round", "fire_at=$fireAt")
    Start-Job -ArgumentList $Container, $file, $vl -ScriptBlock {
        param($c, $f, $vl)
        $a = @("exec", "-i", $c, "psql", "-U", "postgres", "-d", "postgres", "-q")
        foreach ($v in $vl) { $a += @("-v", $v) }
        $a += @("-f", "-")
        Get-Content -Raw $f | & docker @a 2>&1 | Out-String
    }
}

Write-Host "== cross-command matrix: $($scenarios.Count) scenarios x $Rounds rounds"

$round = 0
foreach ($scenario in $scenarios) {
    Write-Host "== $scenario"
    for ($i = 1; $i -le $Rounds; $i++) {
        $round++
        Invoke-Psql (Join-Path $tests "contact_primary_cross_command_setup.sql") @("round=$round") | Out-Null

        $fireAt = Fire-At 2.5
        $jobs = @(
            (Start-Worker $scenario "w1" $round $fireAt),
            (Start-Worker $scenario "w2" $round $fireAt)
        )
        $jobs | Wait-Job -Timeout 120 | Out-Null
        foreach ($j in $jobs) {
            Receive-Job $j | Where-Object { $_ -match "FATAL|could not connect" } | ForEach-Object { Write-Host "  psql: $_" }
            Remove-Job $j -Force
        }
    }
}

Write-Host "== verify + cleanup"
Invoke-Psql (Join-Path $tests "contact_primary_cross_command_verify.sql") @()
