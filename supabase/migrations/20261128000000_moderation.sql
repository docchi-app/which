-- Moderation, part 2: a word filter that's hard to get around, and an AI check
-- on typed polls and comments.
--
-- 1. The word filter (has_blocked_term, used by polls, snaps, comments, usernames
--    and friend lists) now cleans the text before matching:
--      * lower case; accents dropped (fück → fuck); Devanagari nukta and
--        chandrabindu folded (भोसड़ी → भोसडी, गाँड → गांड)
--      * leetspeak: 0 1 3 4 5 7 @ $ ! | + → o i e a s t a s i i t (sh1t, a$$hole, chu+iya)
--      * symbols inside a word dropped (f.u.c.k, b-i-t-c-h), spaced-out letters
--        joined (f u c k), stretched letters folded (fuuuuck, chutiyaaa)
--    Each term is a whole word or phrase ('word'), the start of a word ('root':
--    fuck… catches fucked, fucking), or anywhere ('part', only for long ones that
--    never sit inside an ordinary word). Devanagari terms work too. 'allow' marks
--    an ordinary word that a root would otherwise catch (shiitake, retardant).
--    The list grows from ~40 to ~300: English, Hinglish, Hindi and Marathi (both
--    scripts), and the usual short forms (mc, bc, bsdk…). "chod" on its own goes
--    ("chod do" means "leave it").
--    Admins manage it in Admin → Words (admin_words, admin_add_word,
--    admin_remove_word, admin_test_words).
--
-- 2. The AI check: typed polls and comments go live at once, then the app asks
--    /api/moderate/check to run them past OpenAI's free moderation (snaps already
--    are). Clearly bad → hidden like 3 reports would, and in the Admin queue;
--    unsure → in the Admin queue, still showing. Anything the app didn't send is
--    picked up every 2 minutes by the push job (texts_to_check). Earlier posts
--    count as checked.

-- ─── 1. Word filter ────────────────────────────────────────────────────────

-- The text, cleaned for matching: one space between words, only a–z, 0–9 and Devanagari.
create or replace function public.mod_clean(input text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- k.l: the letters kept (a–z, 0–9, Devanagari U+0900–U+097F). Accents (U+0300–U+036F)
  -- and the nukta (U+093C) are dropped; chandrabindu (U+0901) becomes anusvara (U+0902).
  with k as (select 'a-z0-9' || chr(2304) || '-' || chr(2431) as l)
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        translate(
          replace(replace(regexp_replace(normalize(lower(coalesce(input, '')), NFD), '[' || chr(768) || '-' || chr(879) || ']', '', 'g'),
                          chr(2364), ''), chr(2305), chr(2306)),
          '013457@$!|+', 'oieastasiit'),
        '([' || k.l || '])[*.''`_~^"-]+(?=[' || k.l || '])', '\1', 'g'),
      '[^' || k.l || ']+', ' ', 'g'),
    '\s+', ' ', 'g'))
  from k;
$$;

-- Stretched letters folded: "fuuuck" → "fuck".
create or replace function public.mod_fold(input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(input, '(.)\1+', '\1', 'g');
$$;

alter table public.blocked_terms drop constraint if exists blocked_terms_term_check;
alter table public.blocked_terms add column if not exists kind text not null default 'word';
alter table public.blocked_terms add column if not exists lang text;
alter table public.blocked_terms add column if not exists added_at timestamptz not null default now();
alter table public.blocked_terms drop constraint if exists blocked_terms_kind_check;
alter table public.blocked_terms add constraint blocked_terms_kind_check check (kind in ('word', 'root', 'part', 'allow'));
alter table public.blocked_terms add constraint blocked_terms_term_check
  check (term ~ ('^[a-z0-9' || chr(2304) || '-' || chr(2431) || ']+( [a-z0-9' || chr(2304) || '-' || chr(2431) || ']+)*$')
         and char_length(term) between 2 and 40);

-- Terms are stored cleaned the same way as the text they're matched against.
create or replace function public.blocked_terms_clean()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.term := public.mod_clean(new.term);
  return new;
end;
$$;
drop trigger if exists blocked_terms_clean on public.blocked_terms;
create trigger blocked_terms_clean before insert or update on public.blocked_terms
  for each row execute function public.blocked_terms_clean();

-- Every blocked term found in the text.
create or replace function public.blocked_matches(input text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cleaned text;
  tok text;
  run text := '';
  joined text := '';
  raw text;
  folded text;
  squashed text;
  squashed_folded text;
begin
  -- Cleaned, without the words marked 'allow'.
  cleaned := (
    select coalesce(string_agg(t.w, ' ' order by t.n), '')
    from unnest(string_to_array(public.mod_clean(input), ' ')) with ordinality as t(w, n)
    where t.w <> '' and not exists (select 1 from public.blocked_terms a where a.kind = 'allow' and a.term = t.w));
  if cleaned = '' then
    return '{}';
  end if;
  -- "f u c k": runs of single letters, joined.
  foreach tok in array string_to_array(cleaned, ' ') loop
    if char_length(tok) = 1 then
      run := run || tok;
    else
      if char_length(run) > 1 then joined := joined || ' ' || run; end if;
      run := '';
    end if;
  end loop;
  if char_length(run) > 1 then joined := joined || ' ' || run; end if;

  raw := ' ' || cleaned || ' ' || joined || ' ';
  folded := public.mod_fold(raw);
  squashed := replace(cleaned, ' ', '') || ' ' || replace(joined, ' ', '');
  squashed_folded := public.mod_fold(squashed);
  -- Folded text is only compared with terms that have no double letters of their own
  -- (so "ass" never becomes "as").
  return array(
    select b.term from public.blocked_terms b
    where b.kind <> 'allow' and case b.kind
      when 'word' then position(' ' || b.term || ' ' in raw) > 0
                    or (b.term !~ '(.)\1' and position(' ' || b.term || ' ' in folded) > 0)
      when 'root' then position(' ' || b.term in raw) > 0
                    or (b.term !~ '(.)\1' and position(' ' || b.term in folded) > 0)
      else position(b.term in squashed) > 0
        or (b.term !~ '(.)\1' and position(b.term in squashed_folded) > 0)
    end
    order by b.term);
end;
$$;
revoke execute on function public.blocked_matches(text) from public, anon, authenticated;

create or replace function public.has_blocked_term(input text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select cardinality(public.blocked_matches(input)) > 0;
$$;
revoke execute on function public.has_blocked_term(text) from public, anon, authenticated;

-- The starter list, cleaned like the new ones (some fold together).
-- No temporary table and no SELECT … INTO anywhere in this file: the Supabase SQL
-- editor took those for new tables and failed (relation "c" does not exist).
do $$
declare
  old_terms text[] := array(select b.term from public.blocked_terms b);
begin
  delete from public.blocked_terms;
  insert into public.blocked_terms (term)
  select o.term from unnest(old_terms) as o(term)
  where o.term not in ('chod', 'fuck', 'fucking', 'fucker', 'motherfucker')
  on conflict do nothing;
end;
$$;

insert into public.blocked_terms (term, kind, lang) values
  -- English: roots catch the endings (fucked, fucking, shitty, bitches…).
  ('fuck', 'part', 'en'), ('fck', 'root', 'en'), ('fuk', 'root', 'en'), ('fuq', 'word', 'en'), ('phuck', 'root', 'en'),
  ('shit', 'root', 'en'), ('bullshit', 'word', 'en'), ('horseshit', 'word', 'en'), ('dipshit', 'word', 'en'), ('apeshit', 'word', 'en'),
  ('bitch', 'root', 'en'), ('biatch', 'word', 'en'), ('btch', 'word', 'en'),
  ('cunt', 'root', 'en'), ('twat', 'word', 'en'), ('wank', 'root', 'en'),
  ('asshole', 'root', 'en'), ('arsehole', 'root', 'en'), ('ass', 'word', 'en'), ('dumbass', 'word', 'en'), ('jackass', 'word', 'en'),
  ('bastard', 'root', 'en'), ('dickhead', 'word', 'en'), ('cock', 'word', 'en'), ('cocksuck', 'root', 'en'),
  ('pussies', 'word', 'en'), ('boobs', 'word', 'en'), ('tits', 'word', 'en'), ('titties', 'word', 'en'), ('porn', 'root', 'en'),
  ('whore', 'root', 'en'), ('slut', 'root', 'en'), ('hoe', 'word', 'en'), ('hoes', 'word', 'en'),
  ('raped', 'word', 'en'), ('rapes', 'word', 'en'), ('raping', 'word', 'en'), ('rapist', 'root', 'en'),
  ('retard', 'root', 'en'), ('wtf', 'word', 'en'), ('stfu', 'word', 'en'), ('gtfo', 'word', 'en'), ('motherf', 'root', 'en'),
  ('kys', 'word', 'en'), ('kill yourself', 'word', 'en'), ('kill urself', 'word', 'en'), ('kill ur self', 'word', 'en'),
  ('go die', 'word', 'en'), ('neck yourself', 'word', 'en'),
  -- Slurs.
  ('niggers', 'word', 'en'), ('niggas', 'word', 'en'), ('faggot', 'root', 'en'), ('fags', 'word', 'en'), ('dyke', 'word', 'en'),
  ('tranny', 'word', 'en'), ('chink', 'word', 'en'), ('spic', 'word', 'en'), ('kike', 'word', 'en'), ('paki', 'word', 'en'),

  -- Hindi / Hinglish (Latin letters). Spellings vary a lot, so roots where it's safe.
  ('madarcho', 'root', 'hi'), ('maderco', 'root', 'hi'), ('madercho', 'root', 'hi'), ('maderjat', 'word', 'hi'), ('madarjaat', 'word', 'hi'),
  ('behenchod', 'part', 'hi'), ('behencho', 'root', 'hi'), ('bhenchod', 'part', 'hi'), ('bhencho', 'root', 'hi'), ('benchod', 'part', 'hi'),
  ('bencho', 'word', 'hi'), ('bhanchod', 'part', 'hi'), ('bhainchod', 'part', 'hi'), ('behnchod', 'part', 'hi'), ('bahenchod', 'part', 'hi'),
  ('chutiy', 'root', 'hi'), ('chutia', 'root', 'hi'), ('chootiy', 'root', 'hi'), ('chut', 'word', 'hi'), ('choot', 'word', 'hi'),
  ('bhosd', 'root', 'hi'), ('bhosad', 'root', 'hi'), ('bsdk', 'root', 'hi'), ('bhosdk', 'root', 'hi'),
  ('gaand', 'root', 'hi'), ('gand', 'word', 'hi'), ('gandu', 'word', 'hi'), ('gand mara', 'word', 'hi'), ('gandmara', 'word', 'hi'),
  ('lund', 'word', 'hi'), ('lawda', 'word', 'hi'), ('lauda', 'word', 'hi'), ('lavda', 'word', 'hi'), ('lowda', 'word', 'hi'),
  ('lode', 'word', 'hi'), ('lodu', 'word', 'hi'), ('lawde', 'word', 'hi'), ('laude', 'word', 'hi'), ('lavde', 'word', 'hi'),
  ('randi', 'root', 'hi'), ('raand', 'word', 'hi'), ('randwa', 'word', 'hi'),
  ('haramzada', 'word', 'hi'), ('haramzade', 'word', 'hi'), ('haramzadi', 'word', 'hi'), ('haramkhor', 'word', 'hi'), ('haraamkhor', 'word', 'hi'),
  ('kutiya', 'word', 'hi'), ('kamina', 'word', 'hi'), ('kamine', 'word', 'hi'), ('kameena', 'word', 'hi'), ('kameene', 'word', 'hi'),
  ('kutte ki aulad', 'word', 'hi'), ('kutte kamine', 'word', 'hi'),
  ('chinal', 'word', 'hi'), ('chhinal', 'word', 'hi'), ('bhadwa', 'word', 'hi'), ('bhadwe', 'word', 'hi'), ('bhadva', 'word', 'hi'),
  ('bhadve', 'word', 'hi'), ('bhadua', 'word', 'hi'),
  ('jhaat', 'root', 'hi'), ('jhaant', 'word', 'hi'), ('jhant', 'word', 'hi'), ('jhatu', 'word', 'hi'),
  ('chudai', 'word', 'hi'), ('chudwa', 'root', 'hi'), ('chodna', 'word', 'hi'), ('chodne', 'word', 'hi'), ('chodu', 'word', 'hi'),
  ('phuddi', 'word', 'hi'), ('fuddi', 'word', 'hi'), ('phudi', 'word', 'hi'), ('tatte', 'word', 'hi'),
  ('teri maa ki', 'word', 'hi'), ('teri ma ki', 'word', 'hi'), ('teri behen ki', 'word', 'hi'), ('teri bhen ki', 'word', 'hi'),
  ('maa ki', 'word', 'hi'), ('behen ki', 'word', 'hi'), ('maa chod', 'word', 'hi'), ('maa chuda', 'root', 'hi'), ('bhen ke', 'word', 'hi'),
  ('mc', 'word', 'hi'), ('bc', 'word', 'hi'), ('mkc', 'word', 'hi'), ('tmkc', 'word', 'hi'), ('bkl', 'word', 'hi'), ('bkc', 'word', 'hi'),
  ('mkb', 'word', 'hi'), ('mcbc', 'word', 'hi'), ('bsdke', 'word', 'hi'),

  -- Hindi (Devanagari).
  ('मादरचो', 'root', 'hi'), ('मादरचौ', 'root', 'hi'), ('बहनचो', 'root', 'hi'), ('बहनचौ', 'root', 'hi'), ('भेनचो', 'root', 'hi'),
  ('भैनचो', 'root', 'hi'), ('बेनचो', 'root', 'hi'), ('बहनचोद', 'part', 'hi'), ('मादरचोद', 'part', 'hi'),
  ('चूतिय', 'root', 'hi'), ('चुतिय', 'root', 'hi'), ('चूतिये', 'word', 'hi'), ('चूत', 'root', 'hi'),
  ('भोसड', 'root', 'hi'), ('भोसडी', 'root', 'hi'),
  ('गांड', 'root', 'hi'), ('गांडू', 'word', 'hi'), ('लौडा', 'word', 'hi'), ('लौडे', 'word', 'hi'), ('लोडा', 'word', 'hi'), ('लोडे', 'word', 'hi'),
  ('लंड', 'word', 'hi'), ('लण्ड', 'word', 'hi'), ('रंडी', 'root', 'hi'), ('रण्डी', 'root', 'hi'),
  ('हरामी', 'word', 'hi'), ('हरामजादा', 'word', 'hi'), ('हरामजादे', 'word', 'hi'), ('हरामखोर', 'word', 'hi'),
  ('कुतिया', 'word', 'hi'), ('कमीना', 'word', 'hi'), ('कमीने', 'word', 'hi'), ('छिनाल', 'word', 'hi'),
  ('भडवा', 'word', 'hi'), ('भडवे', 'word', 'hi'), ('झाट', 'root', 'hi'), ('झांट', 'word', 'hi'),
  ('चोदू', 'word', 'hi'), ('चुदाई', 'word', 'hi'), ('चोदना', 'word', 'hi'), ('तेरी मां की', 'word', 'hi'),

  -- Marathi (Latin letters).
  ('zavad', 'part', 'mr'), ('zhavad', 'part', 'mr'), ('zawad', 'part', 'mr'), ('zavn', 'root', 'mr'), ('zhavn', 'root', 'mr'),
  ('zavla', 'word', 'mr'), ('zhavla', 'word', 'mr'), ('zavli', 'word', 'mr'), ('zhavli', 'word', 'mr'), ('zavun', 'word', 'mr'),
  ('zav', 'word', 'mr'), ('zhav', 'word', 'mr'), ('yedzav', 'root', 'mr'), ('yedzhav', 'root', 'mr'),
  ('aaighalya', 'word', 'mr'), ('aighalya', 'word', 'mr'), ('aai ghalya', 'word', 'mr'),
  ('bhadvy', 'root', 'mr'), ('bhadwy', 'root', 'mr'), ('lavdy', 'root', 'mr'), ('lavdyachya', 'word', 'mr'),
  ('randechya', 'word', 'mr'), ('randichya', 'word', 'mr'), ('gandit', 'word', 'mr'),
  ('bhikarchot', 'root', 'mr'), ('bhikarchod', 'root', 'mr'), ('fodri', 'word', 'mr'), ('phodri', 'word', 'mr'),
  ('zhatu', 'word', 'mr'), ('zatu', 'word', 'mr'), ('kutryachya', 'word', 'mr'),

  -- Marathi (Devanagari).
  ('झवाड', 'part', 'mr'), ('जवाड्या', 'word', 'mr'), ('झवला', 'word', 'mr'), ('झवली', 'word', 'mr'), ('झवणे', 'word', 'mr'),
  ('झवतो', 'word', 'mr'), ('झव', 'word', 'mr'), ('येडझव', 'root', 'mr'),
  ('भडव', 'root', 'mr'), ('लवड', 'root', 'mr'), ('रांडे', 'root', 'mr'), ('रांड', 'word', 'mr'),
  ('आईघाल्या', 'word', 'mr'), ('आयघाल्या', 'word', 'mr'), ('भिकारचो', 'root', 'mr'), ('फोद्री', 'word', 'mr'),
  ('कुत्र्याच्या', 'word', 'mr'), ('झाटू', 'word', 'mr'),

  -- Ordinary words a root would catch.
  ('shiitake', 'allow', 'en'), ('retardant', 'allow', 'en'), ('retardants', 'allow', 'en'), ('retardation', 'allow', 'en')
on conflict (term) do update set kind = excluded.kind, lang = excluded.lang;

-- ─── Admin → Words ─────────────────────────────────────────────────────────

create or replace function public.admin_words()
returns table (term text, kind text, lang text, added_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return query select b.term, b.kind, b.lang, b.added_at from public.blocked_terms b order by b.added_at desc, b.term;
end;
$$;
revoke execute on function public.admin_words() from public, anon;
grant execute on function public.admin_words() to authenticated;

-- Adds a word (returns it as stored, after cleaning).
create or replace function public.admin_add_word(term text, kind text default 'word', lang text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := public.mod_clean(term);
begin
  perform public.require_admin();
  if char_length(clean) not between 2 and 40 then
    raise exception 'docchi:word_length' using errcode = '22023';
  end if;
  if coalesce(kind, 'word') not in ('word', 'root', 'part', 'allow') then
    raise exception 'docchi:word_kind' using errcode = '22023';
  end if;
  insert into public.blocked_terms (term, kind, lang) values (clean, coalesce(kind, 'word'), nullif(lang, ''))
  on conflict on constraint blocked_terms_pkey do update set kind = excluded.kind, lang = coalesce(excluded.lang, public.blocked_terms.lang);
  return clean;
end;
$$;
revoke execute on function public.admin_add_word(text, text, text) from public, anon;
grant execute on function public.admin_add_word(text, text, text) to authenticated;

create or replace function public.admin_remove_word(term text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  delete from public.blocked_terms b where b.term = public.mod_clean(admin_remove_word.term);
end;
$$;
revoke execute on function public.admin_remove_word(text) from public, anon;
grant execute on function public.admin_remove_word(text) to authenticated;

-- "Would this be blocked?" — and by which words.
create or replace function public.admin_test_words(input text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return public.blocked_matches(input);
end;
$$;
revoke execute on function public.admin_test_words(text) from public, anon;
grant execute on function public.admin_test_words(text) to authenticated;

-- ─── 2. AI check on typed polls and comments ───────────────────────────────

alter table public.polls add column if not exists text_checked_at timestamptz;
alter table public.polls add column if not exists text_flags jsonb;
alter table public.comments add column if not exists text_checked_at timestamptz;
alter table public.comments add column if not exists text_flags jsonb;
-- Everything posted before this counts as checked.
update public.polls set text_checked_at = now() where text_checked_at is null;
update public.comments set text_checked_at = now() where text_checked_at is null;
create index if not exists polls_text_unchecked_idx on public.polls (created_at) where text_checked_at is null;
create index if not exists comments_text_unchecked_idx on public.comments (created_at) where text_checked_at is null;

-- The checks file reports (reporter: nobody).
alter table public.reports alter column reporter_id drop not null;

-- The text of one thing to check.
create or replace function public.mod_text_of(target_type text, target_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case target_type
    when 'poll' then (
      select concat_ws(' · ', p.teaser, p.question,
               (select string_agg(o.text, ' / ' order by o.position) from public.poll_options o where o.poll_id = p.id))
      from public.polls p where p.id = target_id)
    when 'comment' then (select c.text from public.comments c where c.id = target_id)
  end;
$$;
revoke execute on function public.mod_text_of(text, uuid) from public, anon, authenticated;

-- What the app should send right after posting: this poll (if it's yours and a typed
-- one) and your comments on it, not checked yet.
create or replace function public.my_unchecked_texts(poll uuid)
returns table (target_type text, target_id uuid, body text)
language sql
stable
security definer
set search_path = ''
as $$
  select 'poll', p.id, public.mod_text_of('poll', p.id)
  from public.polls p
  where p.id = poll and p.creator_id = auth.uid() and p.kind <> 'snap' and p.text_checked_at is null and p.deleted_at is null
  union all
  select 'comment', c.id, c.text
  from public.comments c
  where c.poll_id = poll and c.user_id = auth.uid() and c.text_checked_at is null
    and c.created_at > now() - interval '1 hour'
  limit 10;
$$;
revoke execute on function public.my_unchecked_texts(uuid) from public, anon;
grant execute on function public.my_unchecked_texts(uuid) to authenticated;

-- For the push job (every 2 minutes): anything posted in the last 2 days that the
-- app didn't send. Needs the job's secret.
create or replace function public.texts_to_check(secret text, max_rows int default 20)
returns table (target_type text, target_id uuid, body text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:bad_secret' using errcode = '42501';
  end if;
  return query
  (select 'poll'::text, p.id, public.mod_text_of('poll', p.id)
   from public.polls p
   where p.text_checked_at is null and p.kind <> 'snap' and not p.is_system and p.deleted_at is null
     and p.created_at between now() - interval '2 days' and now() - interval '1 minute'
   order by p.created_at limit greatest(1, least(max_rows, 50)))
  union all
  (select 'comment'::text, c.id, c.text
   from public.comments c
   where c.text_checked_at is null
     and c.created_at between now() - interval '2 days' and now() - interval '1 minute'
   order by c.created_at limit greatest(1, least(max_rows, 50)));
end;
$$;
revoke execute on function public.texts_to_check(text, int) from public;
grant execute on function public.texts_to_check(text, int) to anon, authenticated;

-- The check's verdict: 'ok' | 'review' (into the Admin queue) | 'hide' (hidden and
-- into the queue). `reason` is the strongest category, e.g. 'harassment'.
create or replace function public.set_text_verdict(target_type text, target_id uuid, verdict text, flags jsonb, reason text, secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  why text := 'auto:' || coalesce(nullif(regexp_replace(lower(coalesce(reason, '')), '[^a-z/_-]', '', 'g'), ''), 'flagged');
  updated int;
begin
  if not public.push_secret_ok(secret) then
    raise exception 'docchi:bad_secret' using errcode = '42501';
  end if;
  if verdict not in ('ok', 'review', 'hide') or target_type not in ('poll', 'comment') then
    raise exception 'docchi:verdict' using errcode = '22023';
  end if;

  if target_type = 'poll' then
    update public.polls p set text_checked_at = now(), text_flags = flags
    where p.id = target_id and p.text_checked_at is null;
  else
    update public.comments c set text_checked_at = now(), text_flags = flags
    where c.id = target_id and c.text_checked_at is null;
  end if;
  get diagnostics updated = row_count;
  if updated = 0 or verdict = 'ok' then
    return; -- already checked (the app and the job both sent it), or fine
  end if;

  insert into public.reports (target_type, target_id, reporter_id, reason)
  values (target_type, target_id, null, left(why, 60));
  if verdict = 'hide' then
    if target_type = 'poll' then
      update public.polls p set is_hidden = true, hidden_at = now(), hidden_reason = 'reports'
      where p.id = target_id and not p.is_hidden;
    else
      update public.comments c set is_hidden = true, hidden_at = now(), hidden_reason = 'reports'
      where c.id = target_id and not c.is_hidden;
    end if;
  end if;
end;
$$;
revoke execute on function public.set_text_verdict(text, uuid, text, jsonb, text, text) from public;
grant execute on function public.set_text_verdict(text, uuid, text, jsonb, text, text) to anon, authenticated;
