# Atomic Contact Primary Intent — TRIGGER-RACE real-session matrix (local only).
#
# The X-matrix races the new primary commands against the other COMMANDS. THIS
# matrix races them against a RAW, intent-free contact-name write, which fires
# nora_private.sync_individual_company_name — an AFTER UPDATE trigger on
# public.contacts that UPDATEs public.companies while the contact row is
# already held. That edge is contact-row-first by construction and cannot be
# reordered, and it produced the second release-blocking deadlock (2026-09-08,
# 30/30 races) while primary transitions still used a customer ROW lock.
#
#   T-A  raw self-contact first_name write        vs  update_contact make_primary
#   T-B  raw self-contact last_name write         vs  set_primary_contact
#   T-C  Contact-Merge-shaped name write          vs  create_contact make_primary
#   T-D  Contact-Merge-shaped name write          vs  Quick Capture primary change
#   T-E  same rename, transition on a DIFFERENT customer  -> must NOT serialize
#   T-F  ordinary NON-self contact rename         vs  primary transition (normal)
#
# Live reachability of the w1 side: ContactMergeButton -> dataProvider.mergeContacts
# -> raw contacts PATCH of first_name/last_name (no save intent), which the
# provider deliberately does not route through public.update_contact.
#
# Usage (from the repo root, after `npx supabase db reset --local`):
#   powershell -ExecutionPolicy Bypass -File supabase/tests/contact_primary_trigger_race_runner.ps1
#   powershell -ExecutionPolicy Bypass -File supabase/tests/contact_primary_trigger_race_runner.ps1 -Rounds 15 -Container supabase_db_nora-pg17
#
# Never point this at Production. It leaves the two fixture sales rows behind
# (the W6-B guard forbids deleting sales rows); contacts/companies are removed.

param(
    [int]$Rounds = 8,
    [string]$Container = "supabase_db_atomic-crm-demo"
)

$ErrorActionPreference = "Stop"
$tests = $PSScriptRoot
$scenarios = @("T-A", "T-B", "T-C", "T-D", "T-E", "T-F")

function Invoke-Psql([string]$file, [string[]]$vars) {
    $a = @("exec", "-i", $Container, "psql", "-U", "postgres", "-d", "postgres", "-q")
    foreach ($v in $vars) { $a += @("-v", $v) }
    $a += @("-f", "-")
    Get-Content -Raw $file | & docker @a
}

# UTC unix epoch (PowerShell 5.1 "%s" is offset by the local timezone — never use it here)
function Fire-At([double]$seconds) { return ([double][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0) + $seconds }

function Start-Worker([string]$scenario, [string]$role, [int]$round, [double]$fireAt) {
    $file = Join-Path $tests "contact_primary_trigger_race_worker.sql"
    $vl = @("scenario=$scenario", "role=$role", "round=$round", "fire_at=$fireAt")
    Start-Job -ArgumentList $Container, $file, $vl -ScriptBlock {
        param($c, $f, $vl)
        $a = @("exec", "-i", $c, "psql", "-U", "postgres", "-d", "postgres", "-q")
        foreach ($v in $vl) { $a += @("-v", $v) }
        $a += @("-f", "-")
        Get-Content -Raw $f | & docker @a 2>&1 | Out-String
    }
}

Write-Host "== trigger-race matrix: $($scenarios.Count) scenarios x $Rounds rounds"

$round = 0
foreach ($scenario in $scenarios) {
    Write-Host "== $scenario"
    for ($i = 1; $i -le $Rounds; $i++) {
        $round++
        Invoke-Psql (Join-Path $tests "contact_primary_trigger_race_setup.sql") @("round=$round") | Out-Null

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
Invoke-Psql (Join-Path $tests "contact_primary_trigger_race_verify.sql") @()
