# W8-C S3A Storage-Key Serialization — REAL-session concurrency matrix (local only).
#
# Runs the S3A coordination protocol (per-storage-key advisory lock in capture,
# reference admission and inspect) against the local Supabase container with
# genuinely concurrent psql sessions (Start-Job -> docker exec ... psql).
#
# The order of events is COORDINATED, NOT TIMED: a holder performs its
# operation inside an open transaction and signals that with a
# transaction-scoped advisory lock (namespace 7304); the follower starts its
# operation only after it sees that signal in pg_locks; the holder commits only
# after pg_locks shows a session blocked BY it (pg_blocking_pids) and records
# the lock type that session waits on. Every wait has a timeout, and a timeout
# is recorded as a FAILURE - sleeps exist only inside the polling loops.
#
#   C1  LOW-1 original choreography: reference DELETE (capture) holds the key
#       lock, inspect waits on it and then observes DEAD - no skipped_live
#       orphan, the intent stays active
#   C2  reverse: inspect holds the key lock (LIVE -> skipped_live), the
#       reference DELETE waits, then captures a fresh pending intent
#   C3  re-reference of a key with a claimed intent (DEAD) is rejected
#   C4  admission waits behind an inspect holding the key lock, then is rejected
#   C5  admission against an uncommitted DELETE of the same key waits
#       (transactionid) and is rejected by the intent that DELETE captured
#   C6  different keys do not block each other (the lock is per key)
#
# Usage (from the repo root, after `npx supabase db reset --local`):
#   powershell -ExecutionPolicy Bypass -File supabase/tests/attachment_reference_serialization_concurrency_runner.ps1
#
# Never point this at Production. Everything it creates (ars-* rows, the
# public.ars_* tables and functions, one fixture customer) is removed again by
# the final cleanup step.

# -Container lets the same matrix be certified against a second local stack
# (Production runs PG17.6; the default dev stack is PG15).
param(
    [string]$Container = "supabase_db_atomic-crm-demo",
    [int]$Rounds = 5,
    [double]$Timeout = 8.0
)

$ErrorActionPreference = "Stop"
$container = $Container
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tests = Join-Path $root "supabase\tests"
$script:failed = 0

function Fmt([double]$d) { return $d.ToString([Globalization.CultureInfo]::InvariantCulture) }

function Invoke-Psql([string]$file, [hashtable]$vars) {
    $a = @("exec", "-i", $container, "psql", "-U", "postgres", "-d", "postgres", "-q")
    foreach ($k in $vars.Keys) { $a += @("-v", "$k=$($vars[$k])") }
    $a += @("-f", "-")
    # psql writes NOTICEs to stderr; under "Stop" PowerShell 5.1 would turn each
    # one into a terminating error. The exit code alone decides success.
    $ErrorActionPreference = "Continue"
    $out = Get-Content -Raw $file | & docker @a 2>&1 | ForEach-Object { "$_" } | Out-String
    $ok = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = "Stop"
    return @{ Output = $out; Ok = $ok }
}

function Setup([string]$mode, [string]$scenario, [string]$kind) {
    $r = Invoke-Psql (Join-Path $tests "attachment_reference_serialization_concurrency_setup.sql") @{
        mode = $mode; scenario = $scenario; kind = $kind }
    if (-not $r.Ok) { Write-Host $r.Output; throw "setup $mode $scenario failed" }
}

function Ctx([string]$scenario, [string]$key) {
    (& docker exec $container psql -U postgres -d postgres -Atc "select value from public.ars_ctx where scenario = '$scenario' and key = '$key'") -join ""
}

function Verify([string]$scenario, [string]$kind) {
    $r = Invoke-Psql (Join-Path $tests "attachment_reference_serialization_concurrency_verify.sql") @{
        mode = "check"; scenario = $scenario; kind = $kind }
    $r.Output.Split("`n") | Where-Object { $_ -match "NOTICE|ERROR|FAIL" } | ForEach-Object { Write-Host "  $_" }
    if (-not $r.Ok) { $script:failed++; Write-Host "  => $scenario FAILED" } else { Write-Host "  => $scenario ok" }
}

function Start-Worker([string]$scenario, [string]$worker, [hashtable]$vars) {
    $vlist = @("scenario=$scenario", "worker=$worker", "timeout=$(Fmt $Timeout)")
    foreach ($k in @("mode", "key", "note", "job", "token", "signal", "await")) {
        $val = if ($vars.ContainsKey($k)) { [string]$vars[$k] } else { "" }
        $vlist += "$k=$val"
    }
    $file = Join-Path $tests "attachment_reference_serialization_concurrency_worker.sql"
    Start-Job -ArgumentList $container, $file, $vlist -ScriptBlock {
        param($c, $f, $vl)
        $a = @("exec", "-i", $c, "psql", "-U", "postgres", "-d", "postgres", "-q")
        foreach ($v in $vl) { $a += @("-v", $v) }
        $a += @("-f", "-")
        Get-Content -Raw $f | & docker @a 2>&1 | Out-String
    }
}

function Wait-Workers([array]$jobs) {
    $jobs | Wait-Job -Timeout 90 | Out-Null
    foreach ($j in $jobs) {
        if ($j.State -ne "Completed") { $script:failed++; Write-Host "  worker job $($j.Id) did not finish: $($j.State)" }
        Receive-Job $j | ForEach-Object { $_.Split("`n") } | Where-Object { $_ -match "ERROR|FATAL" } |
            ForEach-Object { Write-Host "  psql: $_" }
        Remove-Job $j -Force
    }
}

Write-Host "== init (container $container, $Rounds rounds, wait timeout $(Fmt $Timeout) s)"
Setup "init" "" ""

for ($round = 1; $round -le $Rounds; $round++) {
    # ---- C1: LOW-1 - capture holds the key lock, inspect must wait, then see DEAD
    $s = "C1r$round"
    Write-Host "== $s : reference DELETE (capture) holds K, inspect(J) waits, then observes DEAD"
    Setup "fixture" $s "C1"
    $key = Ctx $s "key"; $job = Ctx $s "job"; $tok = Ctx $s "token"
    $a = Start-Worker $s "A" @{ mode = "hold_delete"; key = $key; await = "blocked" }
    $b = Start-Worker $s "B" @{ mode = "after_inspect"; job = $job; token = $tok; signal = "A" }
    Wait-Workers @($a, $b)
    Verify $s "C1"

    # ---- C2: reverse - inspect holds the key lock (LIVE), the DELETE must wait
    $s = "C2r$round"
    Write-Host "== $s : inspect(J) holds K and observes LIVE, reference DELETE waits, then captures"
    Setup "fixture" $s "C2"
    $key = Ctx $s "key"; $job = Ctx $s "job"; $tok = Ctx $s "token"
    $b = Start-Worker $s "B" @{ mode = "hold_inspect"; job = $job; token = $tok; await = "blocked" }
    $a = Start-Worker $s "A" @{ mode = "after_delete"; key = $key; signal = "B" }
    Wait-Workers @($b, $a)
    Verify $s "C2"

    # ---- C3: re-reference while claimed / DEAD
    $s = "C3r$round"
    Write-Host "== $s : new reference to a key with a claimed intent (DEAD) is rejected"
    Setup "fixture" $s "C3"
    $key = Ctx $s "key"; $note = Ctx $s "note"
    $g = Start-Worker $s "G" @{ mode = "insert"; key = $key; note = $note }
    Wait-Workers @($g)
    Verify $s "C3"

    # ---- C4: admission waits behind inspect
    $s = "C4r$round"
    Write-Host "== $s : inspect(J) holds K with a DEAD verdict, admission of K waits, then is rejected"
    Setup "fixture" $s "C4"
    $key = Ctx $s "key"; $note = Ctx $s "note"; $job = Ctx $s "job"; $tok = Ctx $s "token"
    $i = Start-Worker $s "I" @{ mode = "hold_inspect"; job = $job; token = $tok; await = "blocked" }
    $g = Start-Worker $s "G" @{ mode = "after_insert"; key = $key; note = $note; signal = "I" }
    Wait-Workers @($i, $g)
    Verify $s "C4"

    # ---- C5: admission versus an uncommitted DELETE of the same key
    $s = "C5r$round"
    Write-Host "== $s : uncommitted reference DELETE of K, concurrent admission of K waits, then is rejected"
    Setup "fixture" $s "C5"
    $key = Ctx $s "key"; $note = Ctx $s "note"
    $d = Start-Worker $s "D" @{ mode = "hold_delete"; key = $key; await = "blocked" }
    $g = Start-Worker $s "G" @{ mode = "after_insert"; key = $key; note = $note; signal = "D" }
    Wait-Workers @($d, $g)
    Verify $s "C5"

    # ---- C6: different keys proceed concurrently
    $s = "C6r$round"
    Write-Host "== $s : A holds K1, B deletes K2 without waiting"
    Setup "fixture" $s "C6"
    $key = Ctx $s "key"; $key2 = Ctx $s "key2"
    $a = Start-Worker $s "A" @{ mode = "hold_delete"; key = $key; await = "event:B:DELETE_OK" }
    $b = Start-Worker $s "B" @{ mode = "after_delete"; key = $key2; signal = "A" }
    Wait-Workers @($a, $b)
    Verify $s "C6"
}

Write-Host "== cleanup"
$c = Invoke-Psql (Join-Path $tests "attachment_reference_serialization_concurrency_verify.sql") @{
    mode = "cleanup"; scenario = ""; kind = "" }
$c.Output.Split("`n") | Where-Object { $_ -match "NOTICE|ERROR" } | ForEach-Object { Write-Host "  $_" }
if (-not $c.Ok) { $script:failed++ }

if ($script:failed -gt 0) {
    Write-Host "== RESULT: $($script:failed) FAILED check(s)"
    exit 1
}
Write-Host "== RESULT: all concurrency checks passed"
exit 0
