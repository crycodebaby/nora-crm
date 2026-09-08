# Atomic Contact Primary Intent — REAL-session concurrency matrix (local only).
#
# Runs the six scenarios of docs/nora/06-decision-log.md "Atomic Contact
# Primary Intent" against the local Supabase container using genuinely
# parallel psql sessions (Start-Job → docker exec … psql). Every worker sleeps
# until a shared "fire" instant, so the commands overlap inside Postgres.
#
#   A  two concurrent make_primary (update) for two existing contacts, same customer
#   B  two concurrent create + make_primary for the same customer
#   C  primary replacement while another user replaces it based on a stale expected id
#      (session 1 holds the customer lock, session 2 blocks, then must be refused)
#   D  same create retried with the identical idempotency key (parallel)
#   E  same idempotency key with a different payload (parallel)
#   F  move contact between customers concurrently with a primary change
#
# Usage (from the repo root, after `npx supabase db reset --local` +
# the 20260908120000 migration):
#   powershell -ExecutionPolicy Bypass -File supabase/tests/contact_primary_intent_concurrency_runner.ps1
#
# Never point this at Production. It leaves the two fixture sales rows behind
# (the W6-B guard forbids deleting sales rows); contacts/companies are removed.

$ErrorActionPreference = "Stop"
$container = "supabase_db_atomic-crm-demo"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tests = Join-Path $root "supabase\tests"

function Invoke-Psql([string]$file, [string[]]$vars) {
    $args = @("exec", "-i", $container, "psql", "-U", "postgres", "-d", "postgres", "-q")
    foreach ($v in $vars) { $args += @("-v", $v) }
    $args += @("-f", "-")
    Get-Content -Raw $file | & docker @args
}

function Start-Worker([string]$scenario, [string]$worker, [double]$fireAt, [hashtable]$vars) {
    $vlist = @("scenario=$scenario", "worker=$worker", "fire_at=$fireAt")
    foreach ($k in @("target", "expected", "key", "payload", "patch", "intent")) {
        $val = if ($vars.ContainsKey($k)) { [string]$vars[$k] } else { "" }
        if (($k -eq "payload" -or $k -eq "patch") -and $val -ne "") {
            # JSON travels base64-encoded: PowerShell strips the double quotes
            # of native-command arguments.
            $val = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($val))
        }
        $vlist += "$k=$val"
    }
    $file = Join-Path $tests "contact_primary_intent_concurrency_worker.sql"
    Start-Job -ArgumentList $container, $file, $vlist -ScriptBlock {
        param($c, $f, $vl)
        $a = @("exec", "-i", $c, "psql", "-U", "postgres", "-d", "postgres", "-q")
        foreach ($v in $vl) { $a += @("-v", $v) }
        $a += @("-f", "-")
        Get-Content -Raw $f | & docker @a 2>&1 | Out-String
    }
}

function Query([string]$sql) {
    (& docker exec $container psql -U postgres -d postgres -Atc $sql) -join "`n"
}

Write-Host "== setup fixture"
Invoke-Psql (Join-Path $tests "contact_primary_intent_concurrency_setup.sql") @() | Out-Null
& docker exec $container psql -U postgres -d postgres -Atc "drop table if exists public.cpi_conc_results; create table public.cpi_conc_results (id bigint generated always as identity, scenario text, worker text, outcome text, detail text, operation_id uuid, result jsonb, recorded_at timestamptz default clock_timestamp()); revoke all on public.cpi_conc_results from anon, authenticated, service_role;" | Out-Null

$ids = @{}
foreach ($line in (Query "select key || '=' || id from public.cpi_conc_ctx").Split("`n")) {
    if ($line -match "^(\w+)=(\d+)$") { $ids[$Matches[1]] = [long]$Matches[2] }
}
Write-Host ("fixture ids: " + (($ids.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join " "))

# UTC unix epoch (PowerShell 5.1 "%s" is offset by the local timezone — never use it here)
function Fire-At([double]$seconds) { return ([double][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0) + $seconds }

function Run-Parallel([string]$scenario, [array]$workers) {
    $fireAt = Fire-At 3.0
    $jobs = @()
    $i = 0
    foreach ($w in $workers) {
        $i++
        $jobs += Start-Worker $scenario "w$i" $fireAt $w
    }
    $jobs | Wait-Job -Timeout 60 | Out-Null
    foreach ($j in $jobs) { Receive-Job $j | Where-Object { $_ -match "ERROR|FATAL" } | ForEach-Object { Write-Host "  psql: $_" } ; Remove-Job $j -Force }
}

# ---- A: two concurrent make_primary updates (B and C) on K1, both saw A
Write-Host "== A: two concurrent make_primary (update) on the same customer"
Run-Parallel "A" @(
    @{ target = $ids.b; expected = $ids.a },
    @{ target = $ids.c; expected = $ids.a }
)

# ---- B: two concurrent create + make_primary on K2 (both saw D)
Write-Host "== B: two concurrent create + make_primary on the same customer"
$payloadB1 = '{"first_name":"Conc","last_name":"NewB1","company_id":' + $ids.k2 + '}'
$payloadB2 = '{"first_name":"Conc","last_name":"NewB2","company_id":' + $ids.k2 + '}'
Run-Parallel "B" @(
    @{ payload = $payloadB1; expected = $ids.d },
    @{ payload = $payloadB2; expected = $ids.d }
)

# ---- C: deterministic interleaving — session 1 holds the K3 lock and
# replaces E by a new primary; session 2 (stale, still expects E) must block
# on the lock and then be refused with NORA_PRIMARY_CONTACT_CHANGED.
Write-Host "== C: stale replacement blocked by the customer lock, then refused"
$holderSql = @"
begin;
select set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-0000000000c1',true);
set local role authenticated;
select (public.create_contact('{"first_name":"Conc","last_name":"HolderC","company_id":$($ids.k3)}'::jsonb,'make_primary',$($ids.e),null))->>'contact_id' as new_primary;
select pg_sleep(4);
commit;
"@
$holderJob = Start-Job -ArgumentList $container, $holderSql -ScriptBlock {
    param($c, $sql)
    $sql | & docker exec -i $c psql -U postgres -d postgres -q 2>&1 | Out-String
}
Start-Sleep -Seconds 1
$staleFire = Fire-At 0.2
$staleJob = Start-Worker "C" "stale-update" $staleFire @{ target = $ids.e; expected = $ids.e }
# the create variant of the same stale intent (scenario B = create + make_primary)
$staleJob3 = Start-Worker "B" "stale-create" $staleFire @{ payload = ('{"first_name":"Conc","last_name":"StaleC","company_id":' + $ids.k3 + '}'); expected = $ids.e }
@($holderJob, $staleJob, $staleJob3) | Wait-Job -Timeout 60 | Out-Null
Receive-Job $holderJob | Where-Object { $_ -match "ERROR|FATAL|new_primary" } | ForEach-Object { Write-Host "  holder: $_" }
@($holderJob, $staleJob, $staleJob3) | Remove-Job -Force

# ---- D: same create retried with the identical idempotency key, in parallel
Write-Host "== D: identical idempotency key, identical payload, parallel"
$keyD = [guid]::NewGuid().ToString()
$payloadD = '{"first_name":"Conc","last_name":"IdemD","company_id":' + $ids.k1 + '}'
$holderK1 = Query "select id from public.contacts where company_id=$($ids.k1) and is_primary"
Run-Parallel "D" @(
    @{ payload = $payloadD; expected = $holderK1; key = $keyD },
    @{ payload = $payloadD; expected = $holderK1; key = $keyD },
    @{ payload = $payloadD; expected = $holderK1; key = $keyD }
)

# ---- E: same key, different payload, parallel with an identical one
Write-Host "== E: same idempotency key with a different payload"
$keyE = [guid]::NewGuid().ToString()
$holderK2 = Query "select id from public.contacts where company_id=$($ids.k2) and is_primary"
$payloadE1 = '{"first_name":"Conc","last_name":"IdemE","company_id":' + $ids.k2 + '}'
$payloadE2 = '{"first_name":"Conc","last_name":"IdemE-different","company_id":' + $ids.k2 + '}'
Run-Parallel "E" @(
    @{ payload = $payloadE1; expected = $holderK2; key = $keyE },
    @{ payload = $payloadE2; expected = $holderK2; key = $keyE }
)

# ---- F: move contact between customers concurrently with a primary change
# worker 1 moves K1's current primary to K3 and makes it K3's primary
# (expected = K3's current holder); worker 2 makes another K1 contact primary
# expecting K1's current holder. Both touch K1; the lock order must serialize.
Write-Host "== F: customer move + make_primary vs. make_primary on the source customer"
$holderK1 = Query "select id from public.contacts where company_id=$($ids.k1) and is_primary"
$holderK3 = Query "select id from public.contacts where company_id=$($ids.k3) and is_primary"
$otherK1 = Query "select id from public.contacts where company_id=$($ids.k1) and not is_primary order by id limit 1"
Run-Parallel "F" @(
    @{ target = $holderK1; patch = ('{"company_id":' + $ids.k3 + '}'); intent = "make_primary"; expected = $holderK3 },
    @{ target = $otherK1; patch = "{}"; intent = "make_primary"; expected = $holderK1 }
)

Write-Host "== verify"
Invoke-Psql (Join-Path $tests "contact_primary_intent_concurrency_verify.sql") @()
