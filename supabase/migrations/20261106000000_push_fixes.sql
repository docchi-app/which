-- Push setup tolerates a stray space or newline around the secret (the app
-- trims PUSH_CRON_SECRET too). Run schedule_push again after this if the
-- "Send me a test" button says the secret doesn't match.

create or replace function public.push_secret_ok(secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.push_config c
                 where c.secret_hash = encode(sha256(convert_to(btrim(coalesce(secret, ''), E' \t\r\n'), 'UTF8')), 'hex'));
$$;
revoke execute on function public.push_secret_ok(text) from public, anon, authenticated;

create or replace function public.schedule_push(site_url text, secret text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s text := btrim(coalesce(secret, ''), E' \t\r\n');
  base text := rtrim(btrim(coalesce(site_url, ''), E' \t\r\n'), '/');
begin
  if char_length(s) < 24 then
    raise exception 'Use a long random secret (24+ characters), the same as PUSH_CRON_SECRET in Vercel.';
  end if;
  if base !~ '^https://' then
    raise exception 'site_url should be your app''s https:// address, like https://dochhi.vercel.app';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'Turn on pg_cron first: Database → Extensions → pg_cron.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'Turn on pg_net first: Database → Extensions → pg_net.';
  end if;
  insert into public.push_config (id, secret_hash)
  values (1, encode(sha256(convert_to(s, 'UTF8')), 'hex'))
  on conflict (id) do update set secret_hash = excluded.secret_hash;
  perform cron.schedule('docchi-push', '*/2 * * * *', format(
    'select net.http_post(url := %L, headers := %L::jsonb, body := ''{}''::jsonb, timeout_milliseconds := 60000)',
    base || '/api/push/run',
    jsonb_build_object('Authorization', 'Bearer ' || s, 'Content-Type', 'application/json')::text));
  return 'Push scheduled every 2 minutes → ' || base || '/api/push/run';
end;
$$;
revoke execute on function public.schedule_push(text, text) from public, anon, authenticated;
