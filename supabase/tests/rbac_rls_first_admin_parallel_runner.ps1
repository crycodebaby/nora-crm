# Nora CRM v0.4b.2 — true parallel first-admin test (two psql sessions)
# Run after: npx supabase db reset --local
# Requires: sales table empty, Docker container supabase_db_atomic-crm-demo running

$ErrorActionPreference = "Stop"
$container = "supabase_db_atomic-crm-demo"

function Invoke-Psql($sql) {
    $sql | docker exec -i $container psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q
}

$check = Invoke-Psql "select count(*)::int as c from public.sales;"
if ($check -notmatch "^\s*0\s*$" -and $check -notmatch "c\s*[-|]+\s*0") {
    $count = (Invoke-Psql "select count(*) from public.sales;").Trim()
    if ($count -ne "0" -and $count -notmatch "^count\s*[-|]+\s*0") {
        Write-Error "sales must be empty before parallel test (got: $count)"
    }
}

$uid1 = "c2000000-0000-4000-8000-000000000001"
$uid2 = "c2000000-0000-4000-8000-000000000002"

$sql1 = @"
begin;
select pg_sleep(0.3);
insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, recovery_sent_at, last_sign_in_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
) values (
    '00000000-0000-0000-0000-000000000000', '$uid1', 'authenticated', 'authenticated',
    'runner-1@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', ''
) on conflict (id) do nothing;
commit;
"@

$sql2 = @"
begin;
select pg_sleep(0.3);
insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, recovery_sent_at, last_sign_in_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
) values (
    '00000000-0000-0000-0000-000000000000', '$uid2', 'authenticated', 'authenticated',
    'runner-2@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', ''
) on conflict (id) do nothing;
commit;
"@

$job1 = Start-Job -ScriptBlock {
    param($c, $s)
    $s | docker exec -i $c psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q
} -ArgumentList $container, $sql1

$job2 = Start-Job -ScriptBlock {
    param($c, $s)
    $s | docker exec -i $c psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q
} -ArgumentList $container, $sql2

Wait-Job $job1, $job2 | Out-Null
if ((Receive-Job $job1) -match "ERROR") { Write-Error "Job1 failed: $(Receive-Job $job1)" }
if ((Receive-Job $job2) -match "ERROR") { Write-Error "Job2 failed: $(Receive-Job $job2)" }
Remove-Job $job1, $job2 -Force

$verify = Invoke-Psql @"
do `$`$
declare
    a int; v int;
begin
    select count(*)::int into a from public.sales where role = 'admin';
    select count(*)::int into v from public.sales where role = 'viewer';
    if a <> 1 or v <> 1 then
        raise exception 'parallel runner: expected 1 admin + 1 viewer, got admin=% viewer=%', a, v;
    end if;
end;
`$`$;
delete from public.sales where user_id in ('$uid1', '$uid2');
delete from auth.users where id in ('$uid1', '$uid2');
"@

Write-Host "rbac_rls_first_admin_parallel_runner: OK"
