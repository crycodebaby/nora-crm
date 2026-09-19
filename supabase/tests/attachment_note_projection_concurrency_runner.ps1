# W8-C S3B Note-Attachment Projection — REAL-session concurrency matrix (local only).
#
# Runs the S3B projection (AFTER ROW triggers on contact_notes / deal_notes ->
# minimal delta against public.attachments, on top of the S3A key protocol)
# against the local Supabase container with genuinely concurrent psql sessions
# (Start-Job -> docker exec ... psql).
#
# The order of events is COORDINATED, NOT TIMED: a holder performs its
# operation inside an open transaction and signals that with a
# transaction-scoped advisory lock (namespace 7305); the follower starts only
# after it sees that signal in pg_locks; the holder commits only after pg_locks
# shows a session blocked BY it (pg_blocking_pids) and records the lock type
# that session waits on. For C4 / C5 a harness-only BEFORE INSERT pause hook
# stops both statements just before a chosen row until the peer paused too.
# Every wait has a timeout, and a timeout is recorded as a FAILURE - sleeps
# exist only inside the polling loops.
#
#   C1  same note, concurrent attachment updates (stale second writer)
#   C2  different notes / different keys proceed concurrently
#   C3  two notes add the same new key -> deterministic wait + one clean 23505
#   C4  opposite-order multi-key adds -> sorted order, never a deadlock
#   C5  cross-note swap -> neither side commits (accepted: 40P01 / 23505)
#   C6  ADD K vs S2A2.2 inspect K (claimed, DEAD) -> waits, rejected
#   C7a REMOVE K holds, inspect waits -> DEAD, intent kept (no orphan)
#   C7b inspect holds (LIVE -> skipped_live), REMOVE waits -> fresh pending
#   C8a note DELETE holds, edit waits -> 0 rows, nothing projected
#   C8b edit holds, note DELETE waits -> cascade captures every row
#   C9  edit holds, company delete waits -> cascade captures every row
#
# Usage (from the repo root, after `npx supabase db reset --local`):
#   powershell -ExecutionPolicy Bypass -File supabase/tests/attachment_note_projection_concurrency_runner.ps1
#   ... -Only C4,C5      run a subset (e.g. for a mutation check)
#
# Never point this at Production. Everything it creates (s3bh-* rows, the
# public.s3bh_* tables / functions, the pause hook, the fixture customers) is
# removed again by the final cleanup step.

# -Container lets the same matrix be certified against a second local stack
# (Production runs PG17.6; the default dev stack is PG15).
param(
    [string]$Container = "supabase_db_atomic-crm-demo",
    [int]$Rounds = 5,
    [double]$Timeout = 8.0,
    [string[]]$Only = @()
)

$ErrorActionPreference = "Stop"
# -File passes "C4,C5" as one string
$Only = @($Only | ForEach-Object { $_ -split ',' } | Where-Object { $_ -ne '' })
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
    $r = Invoke-Psql (Join-Path $tests "attachment_note_projection_concurrency_setup.sql") @{
        mode = $mode; scenario = $scenario; kind = $kind }
    if (-not $r.Ok) { Write-Host $r.Output; throw "setup $mode $scenario failed" }
}

function Ctx([string]$scenario, [string]$key) {
    (& docker exec $container psql -U postgres -d postgres -Atc "select value from public.s3bh_ctx where scenario = '$scenario' and key = '$key'") -join ""
}

function Verify([string]$scenario, [string]$kind) {
    $r = Invoke-Psql (Join-Path $tests "attachment_note_projection_concurrency_verify.sql") @{
        mode = "check"; scenario = $scenario; kind = $kind }
    $r.Output.Split("`n") | Where-Object { $_ -match "NOTICE|ERROR|FAIL" } | ForEach-Object { Write-Host "  $_" }
    if (-not $r.Ok) { $script:failed++; Write-Host "  => $scenario FAILED" } else { Write-Host "  => $scenario ok" }
}

function Start-Worker([string]$scenario, [string]$worker, [hashtable]$vars) {
    $vlist = @("scenario=$scenario", "worker=$worker", "timeout=$(Fmt $Timeout)")
    foreach ($k in @("mode", "tbl", "id", "arr", "job", "token", "signal", "await", "pause")) {
        $val = if ($vars.ContainsKey($k)) { [string]$vars[$k] } else { "" }
        $vlist += "$k=$val"
    }
    $file = Join-Path $tests "attachment_note_projection_concurrency_worker.sql"
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

function Run([string]$kind) { return ($Only.Count -eq 0) -or ($Only -contains $kind) }

Write-Host "== init (container $container, $Rounds rounds, wait timeout $(Fmt $Timeout) s)"
Setup "init" "" ""

for ($round = 1; $round -le $Rounds; $round++) {
    if (Run "C1") {
        $s = "C1r$round"
        Write-Host "== $s : same note - A [K1]->[K1,K2] holds, B [K1]->[K1,K3] waits on the row, then reconciles against fresh rows"
        Setup "fixture" $s "C1"
        $n1 = Ctx $s "n1"
        $a = Start-Worker $s "A" @{ mode = "hold_set"; tbl = "contact_notes"; id = $n1; arr = "arr_A"; await = "blocked" }
        $b = Start-Worker $s "B" @{ mode = "after_set"; tbl = "contact_notes"; id = $n1; arr = "arr_B"; signal = "A" }
        Wait-Workers @($a, $b)
        Verify $s "C1"
    }

    if (Run "C2") {
        $s = "C2r$round"
        Write-Host "== $s : different notes / keys - B completes while A holds"
        Setup "fixture" $s "C2"
        $n1 = Ctx $s "n1"; $n2 = Ctx $s "n2"
        $a = Start-Worker $s "A" @{ mode = "hold_set"; tbl = "contact_notes"; id = $n1; arr = "arr_A"; await = "event:B:SET_OK" }
        $b = Start-Worker $s "B" @{ mode = "after_set"; tbl = "contact_notes"; id = $n2; arr = "arr_B"; signal = "A" }
        Wait-Workers @($a, $b)
        Verify $s "C2"
    }

    if (Run "C3") {
        $s = "C3r$round"
        Write-Host "== $s : two notes add the same new key - B waits on the unique index, then 23505"
        Setup "fixture" $s "C3"
        $n1 = Ctx $s "n1"; $n2 = Ctx $s "n2"
        $a = Start-Worker $s "A" @{ mode = "hold_set"; tbl = "contact_notes"; id = $n1; arr = "arr_A"; await = "blocked" }
        $b = Start-Worker $s "B" @{ mode = "after_set"; tbl = "contact_notes"; id = $n2; arr = "arr_B"; signal = "A" }
        Wait-Workers @($a, $b)
        Verify $s "C3"
    }

    if (Run "C4") {
        $s = "C4r$round"
        Write-Host "== $s : opposite-order multi-key adds, both paused mid-statement - sorted order, no deadlock"
        Setup "fixture" $s "C4"
        $n1 = Ctx $s "n1"; $n2 = Ctx $s "n2"; $k1 = Ctx $s "k1"; $k2 = Ctx $s "k2"
        # each worker pauses before the key it would insert SECOND in its own array order
        $a = Start-Worker $s "A" @{ mode = "paused_set"; tbl = "contact_notes"; id = $n1; arr = "arr_A"; signal = "B"; pause = $k2 }
        $b = Start-Worker $s "B" @{ mode = "paused_set"; tbl = "contact_notes"; id = $n2; arr = "arr_B"; signal = "A"; pause = $k1 }
        Wait-Workers @($a, $b)
        Verify $s "C4"
    }

    if (Run "C5") {
        $s = "C5r$round"
        Write-Host "== $s : cross-note swap, both paused between REMOVE and ADD - neither side may commit"
        Setup "fixture" $s "C5"
        $n1 = Ctx $s "n1"; $n2 = Ctx $s "n2"; $k1 = Ctx $s "k1"; $k2 = Ctx $s "k2"
        $a = Start-Worker $s "A" @{ mode = "paused_set"; tbl = "contact_notes"; id = $n1; arr = "arr_A"; signal = "B"; pause = $k2 }
        $b = Start-Worker $s "B" @{ mode = "paused_set"; tbl = "contact_notes"; id = $n2; arr = "arr_B"; signal = "A"; pause = $k1 }
        Wait-Workers @($a, $b)
        Verify $s "C5"
    }

    if (Run "C6") {
        $s = "C6r$round"
        Write-Host "== $s : inspect(J) holds K (DEAD), note ADD of K waits, then is rejected"
        Setup "fixture" $s "C6"
        $n1 = Ctx $s "n1"; $job = Ctx $s "job"; $tok = Ctx $s "token"
        $i = Start-Worker $s "I" @{ mode = "hold_inspect"; job = $job; token = $tok; await = "blocked" }
        $b = Start-Worker $s "B" @{ mode = "after_set"; tbl = "contact_notes"; id = $n1; arr = "arr_B"; signal = "I" }
        Wait-Workers @($i, $b)
        Verify $s "C6"
    }

    if (Run "C7a") {
        $s = "C7ar$round"
        Write-Host "== $s : note REMOVE of K holds the key lock, inspect waits, then observes DEAD"
        Setup "fixture" $s "C7a"
        $n1 = Ctx $s "n1"; $job = Ctx $s "job"; $tok = Ctx $s "token"
        $a = Start-Worker $s "A" @{ mode = "hold_set"; tbl = "contact_notes"; id = $n1; arr = "arr_A"; await = "blocked" }
        $i = Start-Worker $s "I" @{ mode = "after_inspect"; job = $job; token = $tok; signal = "A" }
        Wait-Workers @($a, $i)
        Verify $s "C7a"
    }

    if (Run "C7b") {
        $s = "C7br$round"
        Write-Host "== $s : inspect holds K (LIVE -> skipped_live), note REMOVE waits, then captures"
        Setup "fixture" $s "C7b"
        $n1 = Ctx $s "n1"; $job = Ctx $s "job"; $tok = Ctx $s "token"
        $i = Start-Worker $s "I" @{ mode = "hold_inspect"; job = $job; token = $tok; await = "blocked" }
        $a = Start-Worker $s "A" @{ mode = "after_set"; tbl = "contact_notes"; id = $n1; arr = "arr_A"; signal = "I" }
        Wait-Workers @($i, $a)
        Verify $s "C7b"
    }

    if (Run "C8a") {
        $s = "C8ar$round"
        Write-Host "== $s : note DELETE holds, the attachment edit waits and updates 0 rows"
        Setup "fixture" $s "C8a"
        $n1 = Ctx $s "n1"
        $a = Start-Worker $s "A" @{ mode = "hold_delete"; tbl = "contact_notes"; id = $n1; await = "blocked" }
        $b = Start-Worker $s "B" @{ mode = "after_set"; tbl = "contact_notes"; id = $n1; arr = "arr_A"; signal = "A" }
        Wait-Workers @($a, $b)
        Verify $s "C8a"
    }

    if (Run "C8b") {
        $s = "C8br$round"
        Write-Host "== $s : the attachment edit holds, the note DELETE waits and captures every row"
        Setup "fixture" $s "C8b"
        $n1 = Ctx $s "n1"
        $a = Start-Worker $s "A" @{ mode = "hold_set"; tbl = "contact_notes"; id = $n1; arr = "arr_A"; await = "blocked" }
        $b = Start-Worker $s "B" @{ mode = "after_delete"; tbl = "contact_notes"; id = $n1; signal = "A" }
        Wait-Workers @($a, $b)
        Verify $s "C8b"
    }

    if (Run "C9") {
        $s = "C9r$round"
        Write-Host "== $s : the attachment edit holds, a company delete waits and cascades"
        Setup "fixture" $s "C9"
        $n1 = Ctx $s "n1"; $company = Ctx $s "company"
        $a = Start-Worker $s "A" @{ mode = "hold_set"; tbl = "contact_notes"; id = $n1; arr = "arr_A"; await = "blocked" }
        $b = Start-Worker $s "B" @{ mode = "after_delete"; tbl = "companies"; id = $company; signal = "A" }
        Wait-Workers @($a, $b)
        Verify $s "C9"
    }
}

Write-Host "== cleanup"
$c = Invoke-Psql (Join-Path $tests "attachment_note_projection_concurrency_verify.sql") @{
    mode = "cleanup"; scenario = ""; kind = "" }
$c.Output.Split("`n") | Where-Object { $_ -match "NOTICE|ERROR" } | ForEach-Object { Write-Host "  $_" }
if (-not $c.Ok) { $script:failed++ }

if ($script:failed -gt 0) {
    Write-Host "== RESULT: $($script:failed) FAILED check(s)"
    exit 1
}
Write-Host "== RESULT: all concurrency checks passed"
exit 0
