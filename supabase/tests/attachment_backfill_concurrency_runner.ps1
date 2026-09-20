# W8-C S4 historical attachment backfill — REAL-session concurrency matrix (local only).
#
# Runs the REAL maintenance runner
# (supabase/maintenance/attachment_backfill/10_backfill_one_note.sql, copied
# into the container and invoked with \i) against the local Supabase stack with
# genuinely concurrent psql sessions (Start-Job -> docker exec ... psql). The
# file is one statement, so every invocation is exactly one transaction - the
# same shape an operator uses in Production.
#
# The order of events is COORDINATED, NOT TIMED: a holder performs its operation
# inside an open transaction and signals that with a transaction-scoped advisory
# lock (namespace 7405); the follower starts only after it sees that signal in
# pg_locks; the holder releases only once pg_locks shows a session blocked BY it
# (pg_blocking_pids) or a named event was recorded, and it records what it
# waited on. The backfill itself is stopped mid-transaction by a harness-only
# pause hook on public.attachments - BEFORE its first row exists, or AFTER that
# row and its S3A storage-key lock exist. Every wait has a timeout, and a
# timeout is recorded as a FAILURE; sleeps exist only inside polling loops. The
# ONE deliberate duration is C13, where holding the note row longer than the
# backfill's lock_timeout is the point of the test.
#
#   C1  S4 first, the user's attachment write second  -> final = the user's array
#   C2  the user writes first, S4 second              -> stale-read proof
#   C3  concurrent body-only edit                     -> no projection drift
#   C4  S4 first, note DELETE second                  -> cascade + capture
#   C5  note DELETE first                             -> S4 finds nothing
#   C6  parent contact cascade   C7 parent company cascade   C8 parent deal cascade
#   C9  two backfill workers, same note               -> one works, one skips
#   C10 S4 holds one note, a user writes another      -> not serialized
#   C11 inspect holds the key, S4 waits               -> live -> skipped_live -> S4 succeeds
#   C12 S4 holds the key, inspect waits               -> inspect sees the fresh row
#   C13 a user holds the note row past lock_timeout   -> S4 yields (55P03)
#   C14 four separate processes drain three candidates
#   C15 two further passes stay NO_CANDIDATE
#   S1  the OPERATOR RESULT CONTRACT: every invocation returns its own outcome
#       row to the process that made it - a failure returns none, the next call
#       returns only its own, notices may be switched off entirely, and a fresh
#       connection afterwards carries nothing. Also proves the preflight fails
#       closed in a process that never ran the verifier.
#
# Every `mode = s4` worker's returned row is captured from that PROCESS's own
# stdout and recorded as an S4ROW event, so the per-scenario checks can assert
# what the operator's single call answered. The harness never reads the outcome
# back with a second query - not needing to is exactly what is under test.
#
# Usage (from the repo root, after `npx supabase db reset --local`):
#   powershell -ExecutionPolicy Bypass -File supabase/tests/attachment_backfill_concurrency_runner.ps1
#   ... -Only C2,C12    run a subset (e.g. for a mutation check)
#
# Never point this at Production. Everything it creates (s4h-* rows, the
# public.s4h_* tables / functions, the pause hooks, the fixture customers) is
# removed again by the final cleanup step.

# -Container lets the same matrix be certified against a second local stack
# (Production runs PG17.6; the default dev stack is PG15).
param(
    [string]$Container = "supabase_db_atomic-crm-demo",
    [int]$Rounds = 3,
    [double]$Timeout = 8.0,
    [string[]]$Only = @()
)

$ErrorActionPreference = "Stop"
# -File passes "C2,C12" as one string
$Only = @($Only | ForEach-Object { $_ -split ',' } | Where-Object { $_ -ne '' })
$container = $Container
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tests = Join-Path $root "supabase\tests"
$maint = Join-Path $root "supabase\maintenance\attachment_backfill"
$runnerPath = "/tmp/nora_s4/10_backfill_one_note.sql"
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
    $r = Invoke-Psql (Join-Path $tests "attachment_backfill_concurrency_setup.sql") @{
        mode = $mode; scenario = $scenario; kind = $kind }
    if (-not $r.Ok) { Write-Host $r.Output; throw "setup $mode $scenario failed" }
}

function Ctx([string]$scenario, [string]$key) {
    (& docker exec $container psql -U postgres -d postgres -Atc "select value from public.s4h_ctx where scenario = '$scenario' and key = '$key'") -join ""
}

function Verify([string]$scenario, [string]$kind) {
    $r = Invoke-Psql (Join-Path $tests "attachment_backfill_concurrency_verify.sql") @{
        mode = "check"; scenario = $scenario; kind = $kind }
    if ($r.Ok) {
        $r.Output.Split("`n") | Where-Object { $_ -match "NOTICE|ERROR|FAIL" } | ForEach-Object { Write-Host "  $_" }
        Write-Host "  => $scenario ok"
    } else {
        # a failed check must show its REASON: the exception body lines carry no
        # NOTICE / ERROR prefix, so filtering them away would hide the finding
        $r.Output.Split("`n") | ForEach-Object { Write-Host "  $_" }
        $script:failed++
        Write-Host "  => $scenario FAILED"
    }
}

function Start-Worker([string]$scenario, [string]$worker, [hashtable]$vars) {
    $vlist = @("scenario=$scenario", "worker=$worker", "timeout=$(Fmt $Timeout)", "runner=$runnerPath")
    foreach ($k in @("mode", "tbl", "id", "arr", "job", "token", "signal", "await", "pause", "pausewhen")) {
        $val = if ($vars.ContainsKey($k)) { [string]$vars[$k] } else { "" }
        $vlist += "$k=$val"
    }
    $file = Join-Path $tests "attachment_backfill_concurrency_worker.sql"
    $job = Start-Job -ArgumentList $container, $file, $vlist -ScriptBlock {
        param($c, $f, $vl)
        $a = @("exec", "-i", $c, "psql", "-U", "postgres", "-d", "postgres", "-q")
        foreach ($v in $vl) { $a += @("-v", $v) }
        $a += @("-f", "-")
        Get-Content -Raw $f | & docker @a 2>&1 | Out-String
    }
    return @{ Job = $job; Scenario = $scenario; Worker = $worker }
}

# Record what the operator's ONE invocation returned. The row is taken from that
# process's own stdout - the harness never issues a second query to find it out,
# which is the whole point of the contract being tested.
function Record-Row([string]$scenario, [string]$worker, [string]$out) {
    $row = ($out -split "`n" | ForEach-Object { $_.Trim() } |
            Where-Object { $_ -match '^(BACKFILLED|SKIPPED_ALREADY_EXACT|NO_CANDIDATE)\|' } | Select-Object -First 1)
    if ($null -eq $row) { $row = "<no row>" }
    $esc = $row.Replace("'", "''")
    & docker exec $container psql -U postgres -d postgres -q -Atc `
        "select public.s4h_log('$scenario', '$worker', 'S4ROW', '$esc')" | Out-Null
    return $row
}

function Wait-Workers([array]$workers) {
    ($workers | ForEach-Object { $_.Job }) | Wait-Job -Timeout 90 | Out-Null
    foreach ($w in $workers) {
        $j = $w.Job
        if ($j.State -ne "Completed") { $script:failed++; Write-Host "  worker job $($j.Id) did not finish: $($j.State)" }
        $out = (Receive-Job $j | Out-String)
        # psql's own diagnostics only - not PowerShell's NativeCommandError noise
        $out.Split("`n") | Where-Object { $_ -match "(ERROR|FATAL|PANIC):" } | ForEach-Object { Write-Host "  psql: $_" }
        if ($w.Worker -ne "") { Record-Row $w.Scenario $w.Worker $out | Out-Null }
        Remove-Job $j -Force
    }
}

# one full, separate runner process - the "restart" of C14 / C15
function Invoke-Runner([string]$scenario, [string]$worker) {
    $w = Start-Worker $scenario $worker @{ mode = "s4" }
    Wait-Workers @($w)
}

# The REAL maintenance file, one separate process, nothing else in the session.
# Returns what that single invocation printed plus its exit code - this is the
# operator's view, with no readback and no second connection.
function Invoke-RunnerDirect([string]$file) {
    # ON_ERROR_STOP=1 is part of the documented fallback invocation, and it is
    # what makes the exit code trustworthy: plain psql reports success even
    # after a statement failed.
    $ErrorActionPreference = "Continue"
    $out = (& docker exec -i $container psql -U postgres -d postgres -q -At -v ON_ERROR_STOP=1 -f $file 2>&1 |
            ForEach-Object { "$_" } | Out-String)
    $ok = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = "Stop"
    $row = ($out -split "`n" | ForEach-Object { $_.Trim() } |
            Where-Object { $_ -match '^(BACKFILLED|SKIPPED_ALREADY_EXACT|NO_CANDIDATE)\|' } | Select-Object -First 1)
    return @{ Row = $(if ($null -eq $row) { "<no row>" } else { $row }); Ok = $ok; Output = $out }
}

function Expect([string]$label, [string]$actual, [string]$want) {
    if ($actual -eq $want) { Write-Host "  ok   $label : $actual" }
    else { $script:failed++; Write-Host "  FAIL $label : got '$actual', want '$want'" }
}

# Wait until a worker signalled that it is paused. The PAUSED row itself is
# still inside that worker's open transaction and therefore invisible here - the
# advisory signal lock is what crosses the session boundary.
function Wait-Paused([string]$scenario, [string]$worker) {
    $deadline = (Get-Date).AddSeconds($Timeout)
    while ((Get-Date) -lt $deadline) {
        $n = (& docker exec $container psql -U postgres -d postgres -Atc `
              "select public.s4h_signaled('$scenario', '$worker-paused')") -join ""
        if ($n -eq "t") { return $true }
        Start-Sleep -Milliseconds 50
    }
    $script:failed++
    Write-Host "  $scenario : $worker never signalled that it paused"
    return $false
}

function Run([string]$kind) { return ($Only.Count -eq 0) -or ($Only -contains $kind) }

Write-Host "== init (container $container, $Rounds rounds, wait timeout $(Fmt $Timeout) s)"
& docker exec $container rm -rf /tmp/nora_s4 | Out-Null
& docker cp $maint "${container}:/tmp/nora_s4" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "could not copy the maintenance directory into $container" }
Setup "init" "" ""

for ($round = 1; $round -le $Rounds; $round++) {
    if (Run "C1") {
        $s = "C1r$round"
        Write-Host "== $s : S4 holds the note row, the user's attachment write waits and then extends"
        Setup "fixture" $s "C1"
        $n1 = Ctx $s "n1"; $k1 = Ctx $s "k1"
        $a = Start-Worker $s "A" @{ mode = "hold_s4"; pause = $k1; pausewhen = "before"; await = "blocked" }
        $b = Start-Worker $s "B" @{ mode = "after_set"; tbl = "contact_notes"; id = $n1; arr = "arr_B"; signal = "A-paused" }
        Wait-Workers @($a, $b)
        Verify $s "C1"
    }

    if (Run "C2") {
        $s = "C2r$round"
        Write-Host "== $s : the user writes first (S3B projects), S4 waits and must read the FRESH state"
        Setup "fixture" $s "C2"
        $n1 = Ctx $s "n1"
        $b = Start-Worker $s "B" @{ mode = "hold_set"; tbl = "contact_notes"; id = $n1; arr = "arr_A"; await = "blocked" }
        $a = Start-Worker $s "A" @{ mode = "s4"; signal = "B" }
        Wait-Workers @($b, $a)
        Verify $s "C2"
    }

    if (Run "C3") {
        $s = "C3r$round"
        Write-Host "== $s : a concurrent body-only edit must not disturb the projection"
        Setup "fixture" $s "C3"
        $n1 = Ctx $s "n1"; $k1 = Ctx $s "k1"
        $a = Start-Worker $s "A" @{ mode = "hold_s4"; pause = $k1; pausewhen = "before"; await = "blocked" }
        $b = Start-Worker $s "B" @{ mode = "after_text"; tbl = "contact_notes"; id = $n1; signal = "A-paused" }
        Wait-Workers @($a, $b)
        Verify $s "C3"
    }

    if (Run "C4") {
        $s = "C4r$round"
        Write-Host "== $s : S4 first, the note DELETE waits - cascade removes the fresh rows and captures"
        Setup "fixture" $s "C4"
        $n1 = Ctx $s "n1"; $k1 = Ctx $s "k1"
        $a = Start-Worker $s "A" @{ mode = "hold_s4"; pause = $k1; pausewhen = "before"; await = "blocked" }
        $b = Start-Worker $s "B" @{ mode = "after_delete"; tbl = "contact_notes"; id = $n1; signal = "A-paused" }
        Wait-Workers @($a, $b)
        Verify $s "C4"
    }

    if (Run "C5") {
        $s = "C5r$round"
        Write-Host "== $s : the note DELETE holds, S4 waits and then finds no candidate"
        Setup "fixture" $s "C5"
        $n1 = Ctx $s "n1"
        $b = Start-Worker $s "B" @{ mode = "hold_delete"; tbl = "contact_notes"; id = $n1; await = "blocked" }
        $a = Start-Worker $s "A" @{ mode = "s4"; signal = "B" }
        Wait-Workers @($b, $a)
        Verify $s "C5"
    }

    if (Run "C6") {
        $s = "C6r$round"
        Write-Host "== $s : S4 first, the parent contact delete waits and cascades"
        Setup "fixture" $s "C6"
        $contact = Ctx $s "contact"; $k1 = Ctx $s "k1"
        $a = Start-Worker $s "A" @{ mode = "hold_s4"; pause = $k1; pausewhen = "before"; await = "blocked" }
        $b = Start-Worker $s "B" @{ mode = "after_delete"; tbl = "contacts"; id = $contact; signal = "A-paused" }
        Wait-Workers @($a, $b)
        Verify $s "C6"
    }

    if (Run "C7") {
        $s = "C7r$round"
        Write-Host "== $s : S4 first, the parent company delete waits and cascades"
        Setup "fixture" $s "C7"
        $company = Ctx $s "company"; $k1 = Ctx $s "k1"
        $a = Start-Worker $s "A" @{ mode = "hold_s4"; pause = $k1; pausewhen = "before"; await = "blocked" }
        $b = Start-Worker $s "B" @{ mode = "after_delete"; tbl = "companies"; id = $company; signal = "A-paused" }
        Wait-Workers @($a, $b)
        Verify $s "C7"
    }

    if (Run "C8") {
        $s = "C8r$round"
        Write-Host "== $s : S4 backfills a DEAL note, the parent deal delete waits and cascades"
        Setup "fixture" $s "C8"
        $deal = Ctx $s "deal"; $k1 = Ctx $s "k1"
        $a = Start-Worker $s "A" @{ mode = "hold_s4"; pause = $k1; pausewhen = "before"; await = "blocked" }
        $b = Start-Worker $s "B" @{ mode = "after_delete"; tbl = "deals"; id = $deal; signal = "A-paused" }
        Wait-Workers @($a, $b)
        Verify $s "C8"
    }

    if (Run "C9") {
        $s = "C9r$round"
        Write-Host "== $s : two backfill workers on the same note - one works, one skips"
        Setup "fixture" $s "C9"
        $k1 = Ctx $s "k1"
        $a = Start-Worker $s "A" @{ mode = "hold_s4"; pause = $k1; pausewhen = "before"; await = "blocked" }
        $b = Start-Worker $s "B" @{ mode = "s4"; signal = "A-paused" }
        Wait-Workers @($a, $b)
        Verify $s "C9"
    }

    if (Run "C10") {
        $s = "C10r$round"
        Write-Host "== $s : S4 holds one note while a user attachment write on another note completes"
        Setup "fixture" $s "C10"
        $n2 = Ctx $s "n2"; $k1 = Ctx $s "k1"
        $a = Start-Worker $s "A" @{ mode = "hold_s4"; pause = $k1; pausewhen = "before"; await = "event:B:SET_OK" }
        $b = Start-Worker $s "B" @{ mode = "after_set"; tbl = "contact_notes"; id = $n2; arr = "arr_B"; signal = "A-paused" }
        Wait-Workers @($a, $b)
        Verify $s "C10"
    }

    if (Run "C11") {
        $s = "C11r$round"
        Write-Host "== $s : inspect holds the storage key, S4's admission waits, then succeeds"
        Setup "fixture" $s "C11"
        $job = Ctx $s "job"; $tok = Ctx $s "token"
        $i = Start-Worker $s "I" @{ mode = "hold_inspect"; job = $job; token = $tok; await = "blocked" }
        $a = Start-Worker $s "A" @{ mode = "s4"; signal = "I" }
        Wait-Workers @($i, $a)
        Verify $s "C11"
    }

    if (Run "C12") {
        $s = "C12r$round"
        Write-Host "== $s : S4 holds the storage key (paused after its INSERT), inspect waits"
        Setup "fixture" $s "C12"
        $k1 = Ctx $s "k1"
        $a = Start-Worker $s "A" @{ mode = "hold_s4"; pause = $k1; pausewhen = "after"; await = "blocked" }
        if (Wait-Paused $s "A") {
            # record the claimed intent only NOW: before the INSERT it would have
            # blocked S4's admission, and that is a different scenario
            Setup "arm_job" $s "C12"
            $job = Ctx $s "job"; $tok = Ctx $s "token"
            $i = Start-Worker $s "I" @{ mode = "after_inspect"; job = $job; token = $tok }
            Wait-Workers @($a, $i)
        } else {
            Wait-Workers @($a)
        }
        Verify $s "C12"
    }

    if (Run "C13") {
        $s = "C13r$round"
        Write-Host "== $s : a user holds the note row past the backfill's lock_timeout - S4 yields"
        Setup "fixture" $s "C13"
        $n1 = Ctx $s "n1"
        $b = Start-Worker $s "B" @{ mode = "hold_set"; tbl = "contact_notes"; id = $n1; arr = "arr_A"; await = "seconds:5" }
        $a = Start-Worker $s "A" @{ mode = "s4"; signal = "B" }
        Wait-Workers @($b, $a)
        Verify $s "C13"
    }

    if (Run "C14") {
        $s = "C14r$round"
        Write-Host "== $s : four separate runner processes drain three candidates"
        Setup "fixture" $s "C14"
        Invoke-Runner $s "P1"
        Invoke-Runner $s "P2"
        Invoke-Runner $s "P3"
        Invoke-Runner $s "P4"
        Verify $s "C14"
    }

    if (Run "C15") {
        $s = "C15r$round"
        Write-Host "== $s : two further passes stay NO_CANDIDATE and change nothing"
        Setup "fixture" $s "C15"
        foreach ($p in @("P1", "P2", "P3", "P4", "P5", "P6")) { Invoke-Runner $s $p }
        Verify $s "C15"
    }

    if (Run "S1") {
        $s = "S1r$round"
        Write-Host "== $s : the OPERATOR RESULT CONTRACT - one call, one row, no readback, no leak"
        Setup "fixture" $s "S1"
        $n1 = Ctx $s "n1"; $n2 = Ctx $s "n2"; $k1 = Ctx $s "k1"

        # F: a failing invocation returns NO row - a failure can never look like
        # an outcome, and least of all like NO_CANDIDATE
        $r = Invoke-RunnerDirect $runnerPath
        Expect "$s F  failed call exit"  $(if ($r.Ok) { "success" } else { "error" }) "error"
        Expect "$s F  failed call row"   $r.Row "<no row>"
        if ($r.Output -notmatch "deletion intent") {
            $script:failed++; Write-Host "  FAIL $s F : the failure was not the expected refusal"
        }

        # F2: the same failure with ON_ERROR_STOP OFF. F above is necessary but
        # not sufficient on its own: with ON_ERROR_STOP=1 psql stops at the
        # failed work statement, so the report statement never runs and "no
        # row" is the client's doing, not the payload's. Here the report
        # statement DOES run after the failure, and it must still print
        # nothing - this is the process-level twin of suite section 7f.
        $ErrorActionPreference = "Continue"
        $soft = (& docker exec -i $container psql -U postgres -d postgres -q -At -f $runnerPath 2>&1 |
                 ForEach-Object { "$_" } | Out-String)
        $ErrorActionPreference = "Stop"
        $srow = ($soft -split "`n" | ForEach-Object { $_.Trim() } |
                 Where-Object { $_ -match '^(BACKFILLED|SKIPPED_ALREADY_EXACT|NO_CANDIDATE)\|' } | Select-Object -First 1)
        Expect "$s F2 failed call row, report statement reached" `
               $(if ($null -eq $srow) { "<no row>" } else { $srow }) "<no row>"
        if ($soft -notmatch "deletion intent") {
            $script:failed++; Write-Host "  FAIL $s F2 : the failure was not the expected refusal"
        }

        # G: the next invocation returns ONLY its own current result
        Setup "clear_queue" $s "S1"
        $r = Invoke-RunnerDirect $runnerPath
        Expect "$s G  after a failure" $r.Row "BACKFILLED|contact_notes|$n1|1"

        # A + H: a second, separate process advances to the next note - and does
        # so with notices switched OFF, so correctness cannot be resting on
        # NOTICE output anywhere
        $ErrorActionPreference = "Continue"
        $quiet = (& docker exec -i $container psql -U postgres -d postgres -q -At -v ON_ERROR_STOP=1 `
                  -c "set client_min_messages = error" -f $runnerPath 2>&1 | ForEach-Object { "$_" } | Out-String)
        $ErrorActionPreference = "Stop"
        $qrow = ($quiet -split "`n" | ForEach-Object { $_.Trim() } |
                 Where-Object { $_ -match '^(BACKFILLED|SKIPPED_ALREADY_EXACT|NO_CANDIDATE)\|' } | Select-Object -First 1)
        Expect "$s AH next candidate, notices off" $(if ($null -eq $qrow) { "<no row>" } else { $qrow }) `
               "BACKFILLED|contact_notes|$n2|1"
        if ($quiet -match "NOTICE") { $script:failed++; Write-Host "  FAIL $s H : notices were not actually suppressed" }

        # C: the drained corpus reports NO_CANDIDATE, in the same call
        $r = Invoke-RunnerDirect $runnerPath
        Expect "$s C  drained"         $r.Row "NO_CANDIDATE|||0"

        # D + E: nothing has to be read back. A brand-new session - which is what
        # a pooled MCP call may land on - carries no outcome at all, and none of
        # the calls above ever needed one.
        $leak = (& docker exec $container psql -U postgres -d postgres -q -Atc `
                 "select coalesce(nullif(current_setting('nora.s4_backfill_outcome', true), ''), '<empty>')") -join ""
        Expect "$s DE fresh session"   $leak "<empty>"

        # The SESSION CONTRACT of the preflight, in a fresh process: without the
        # verifier's pg_temp helper it fails closed and never answers GO.
        $ErrorActionPreference = "Continue"
        $pf = (& docker exec -i $container psql -U postgres -d postgres -q -At -v ON_ERROR_STOP=1 `
               -f "/tmp/nora_s4/00_preflight.sql" 2>&1 | ForEach-Object { "$_" } | Out-String)
        $pfOk = ($LASTEXITCODE -eq 0)
        $ErrorActionPreference = "Stop"
        Expect "$s VM preflight alone" $(if ($pfOk) { "success" } else { "error" }) "error"
        if ($pf -notmatch "is not defined in this session" -or $pf -match "PREFLIGHT: GO") {
            $script:failed++; Write-Host "  FAIL $s VM : the preflight did not fail closed without the verifier"
            Write-Host "  $pf"
        }

        Verify $s "S1"
    }
}

Write-Host "== cleanup"
$c = Invoke-Psql (Join-Path $tests "attachment_backfill_concurrency_verify.sql") @{
    mode = "cleanup"; scenario = ""; kind = "" }
$c.Output.Split("`n") | Where-Object { $_ -match "NOTICE|ERROR" } | ForEach-Object { Write-Host "  $_" }
if (-not $c.Ok) { $script:failed++ }
& docker exec $container rm -rf /tmp/nora_s4 | Out-Null

if ($script:failed -gt 0) {
    Write-Host "== RESULT: $($script:failed) FAILED check(s)"
    exit 1
}
Write-Host "== RESULT: all concurrency checks passed"
exit 0
