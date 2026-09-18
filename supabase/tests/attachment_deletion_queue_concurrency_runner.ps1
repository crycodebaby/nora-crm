# W8-C S2A2.2 Attachment Deletion Queue — REAL-session concurrency matrix (local only).
#
# Runs the queue execution contract against the local Supabase container using
# genuinely parallel psql sessions (Start-Job -> docker exec ... psql). Every
# worker sleeps until a shared "fire" instant, so the calls overlap inside
# Postgres. A test-only transition-log trigger records every state / token
# change of the queue, so "exactly once" is read from the log.
#
#   C1   N sessions x M claims (each its own transaction) against K due jobs:
#        disjoint claims, no job claimed twice                       (rounds)
#   C2   session A holds its claim open, session B claims a DIFFERENT job
#        without waiting for A (SKIP LOCKED, claim selection)        (rounds)
#   C2b  session A row-locks an EXPIRED claim; session B's stale
#        recovery skips it and B completes before A releases
#        (SKIP LOCKED, stale recovery; coordinated, not timed)       (rounds)
#   C3   concurrent claimers race around the same expired leases: each lease
#        recovered exactly once, no attempt increment, <= 25 / tx    (rounds)
#   C4   the lease holder's fail races stale recovery around the expiry
#        instant: exactly one side releases the job                  (rounds)
#   C4b  stale token A and current token B fail the reclaimed job at once:
#        only B's write lands                                        (rounds)
#
# Usage (from the repo root, after `npx supabase db reset --local`):
#   powershell -ExecutionPolicy Bypass -File supabase/tests/attachment_deletion_queue_concurrency_runner.ps1
#
# Never point this at Production. Everything it creates (aqc-* queue rows, the
# public.aqc_* log tables / recorder functions and the queue trigger) is
# removed again by the final cleanup step.

# -Container lets the same matrix be certified against a second local stack
# (Production runs PG17.6; the default dev stack is PG15).
param(
    [string]$Container = "supabase_db_atomic-crm-demo",
    [int]$Rounds = 3
)

$ErrorActionPreference = "Stop"
$container = $Container
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tests = Join-Path $root "supabase\tests"
$script:failed = 0

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

function Setup([string]$mode, [string]$scenario, [int]$jobs, [string]$expireAt) {
    $r = Invoke-Psql (Join-Path $tests "attachment_deletion_queue_concurrency_setup.sql") @{
        mode = $mode; scenario = $scenario; jobs = $jobs; expire_at = $expireAt }
    if (-not $r.Ok) { Write-Host $r.Output; throw "setup $mode $scenario failed" }
}

function Verify([string]$scenario, [int]$workers, [int]$count) {
    $r = Invoke-Psql (Join-Path $tests "attachment_deletion_queue_concurrency_verify.sql") @{
        mode = "check"; scenario = $scenario; workers = $workers; count = $count }
    $r.Output.Split("`n") | Where-Object { $_ -match "NOTICE|ERROR|FAIL|^\s+\S" } | ForEach-Object { Write-Host "  $_" }
    if (-not $r.Ok) { $script:failed++; Write-Host "  => $scenario FAILED" } else { Write-Host "  => $scenario ok" }
}

function Query([string]$sql) {
    (& docker exec $container psql -U postgres -d postgres -Atc $sql) -join "`n"
}

# UTC unix epoch (PowerShell 5.1 "%s" is offset by the local timezone - never use it here)
function Now-Epoch() { return [double][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0 }
function Fmt([double]$d) { return $d.ToString([Globalization.CultureInfo]::InvariantCulture) }

function Start-Worker([string]$scenario, [string]$worker, [double]$fireAt, [hashtable]$vars) {
    $vlist = @("scenario=$scenario", "worker=$worker", "fire_at=$(Fmt $fireAt)")
    foreach ($k in @("mode", "count", "hold", "job", "token", "code")) {
        $val = if ($vars.ContainsKey($k)) { [string]$vars[$k] } else { "" }
        $vlist += "$k=$val"
    }
    $file = Join-Path $tests "attachment_deletion_queue_concurrency_worker.sql"
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
        Receive-Job $j | ForEach-Object { $_.Split("`n") } | Where-Object { $_ -match "ERROR|FATAL" } |
            ForEach-Object { Write-Host "  psql: $_" }
        Remove-Job $j -Force
    }
}

Write-Host "== init (container $container, $Rounds rounds)"
Setup "init" "" 0 ""

for ($round = 1; $round -le $Rounds; $round++) {
    # ---- C1: 8 sessions x 2 claims against 12 due jobs
    $s = "C1r$round"
    Write-Host "== $s : 8 sessions x 2 claims vs 12 due jobs"
    Setup "fixture" $s 12 ""
    $fire = (Now-Epoch) + 3.0
    $jobs = @()
    for ($w = 1; $w -le 8; $w++) { $jobs += Start-Worker $s "w$w" $fire @{ mode = "claim"; count = 2 } }
    Wait-Workers $jobs
    Verify $s 8 2

    # ---- C2: holder keeps its claim open 4 s; the second session must not wait
    $s = "C2r$round"
    Write-Host "== $s : SKIP LOCKED - claim while another session holds the oldest job"
    Setup "fixture" $s 3 ""
    $fire = (Now-Epoch) + 3.0
    $holder = Start-Worker $s "holder" $fire @{ mode = "hold"; hold = 4 }
    $skipper = Start-Worker $s "skipper" ($fire + 1.5) @{ mode = "claim"; count = 1 }
    Wait-Workers @($holder, $skipper)
    Verify $s 0 0

    # ---- C2b: stale RECOVERY skips an expired claim that another session has row-locked.
    #      Coordinated, not timed: the holder signals its lock (advisory lock), the
    #      claimer starts only after that signal, and the holder releases only after
    #      it sees the claimer's committed result - or after 10 s, which fails the check.
    $s = "C2b-r$round"
    Write-Host "== $s : SKIP LOCKED - stale recovery while another session row-locks an expired claim"
    Setup "fixture" $s 0 ""
    $locked = Query "select value from public.aqc_ctx where scenario = '$s' and key = 'locked'"
    $fire = (Now-Epoch) + 3.0
    $holder = Start-Worker $s "holder" $fire @{ mode = "lockstale"; job = $locked; hold = 10 }
    $claimer = Start-Worker $s "claimer" $fire @{ mode = "waitclaim"; hold = 10 }
    Wait-Workers @($holder, $claimer)
    Verify $s 0 0

    # ---- C3: 3 claimers race around 40 expired leases (capacity 3 x 25)
    $s = "C3r$round"
    Write-Host "== $s : 3 concurrent claimers vs 40 expired leases, nothing due"
    Setup "fixture" $s 40 ""
    $fire = (Now-Epoch) + 3.0
    $jobs = @()
    for ($w = 1; $w -le 3; $w++) { $jobs += Start-Worker $s "w$w" $fire @{ mode = "claim"; count = 1 } }
    Wait-Workers $jobs
    Verify $s 0 0

    # ---- C4: holder fail vs recovery around the expiry instant (offsets vary per round)
    foreach ($offset in @(-0.15, 0.0, 0.15)) {
        $s = "C4r$round" + "o" + ([int]($offset * 100)).ToString().Replace("-", "m")
        $expire = (Now-Epoch) + 4.0
        Write-Host "== $s : holder fail at expiry $(Fmt $offset) s vs concurrent recovery"
        Setup "fixture" $s 1 (Fmt $expire)
        $job = Query "select value from public.aqc_ctx where scenario = '$s' and key = 'job'"
        $tok = Query "select value from public.aqc_ctx where scenario = '$s' and key = 'token'"
        $h = Start-Worker $s "holder" ($expire + $offset) @{ mode = "fail"; job = $job; token = $tok; code = "NORA_ATTACHMENT_CONC_HOLDER" }
        $r = Start-Worker $s "recoverer" $expire @{ mode = "claim"; count = 1 }
        Wait-Workers @($h, $r)
        Verify $s 0 0
    }

    # ---- C4b: stale token A vs current token B on the reclaimed job
    $s = "C4b-r$round"
    Write-Host "== $s : stale holder A and current holder B fail the reclaimed job at once"
    Setup "fixture" $s 1 ""
    $job = Query "select value from public.aqc_ctx where scenario = '$s' and key = 'job'"
    $tokA = Query "select value from public.aqc_ctx where scenario = '$s' and key = 'token_a'"
    $tokB = Query "select value from public.aqc_ctx where scenario = '$s' and key = 'token_b'"
    $fire = (Now-Epoch) + 3.0
    $a = Start-Worker $s "stale-a" $fire @{ mode = "fail"; job = $job; token = $tokA; code = "NORA_ATTACHMENT_CONC_A" }
    $b = Start-Worker $s "current-b" $fire @{ mode = "fail"; job = $job; token = $tokB; code = "NORA_ATTACHMENT_CONC_B" }
    Wait-Workers @($a, $b)
    Verify $s 0 0
}

Write-Host "== cleanup"
$c = Invoke-Psql (Join-Path $tests "attachment_deletion_queue_concurrency_verify.sql") @{
    mode = "cleanup"; scenario = ""; workers = ""; count = "" }
$c.Output.Split("`n") | Where-Object { $_ -match "NOTICE|ERROR" } | ForEach-Object { Write-Host "  $_" }
if (-not $c.Ok) { $script:failed++ }

if ($script:failed -gt 0) {
    Write-Host "== RESULT: $($script:failed) FAILED check(s)"
    exit 1
}
Write-Host "== RESULT: all concurrency checks passed"
exit 0
