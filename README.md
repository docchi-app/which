# Docchi

**Docchi. Which one?** A light, fun poll app: tap a side, then see where everyone else landed.
It's a mobile-first PWA built with Next.js and Supabase.

Product and design background: [`docs/HANDOFF-docchi.md`](docs/HANDOFF-docchi.md) and
[`docs/poll-app-validation.md`](docs/poll-app-validation.md). The screens are on the design canvas
linked in the handoff.

## What's built so far

The first slice of the build order:

- **Feed:** Trending and New tabs, Poll of the Day pinned on top, a card stack with Next and Skip,
  and an "all caught up" card at the end. A shared link (`/?poll=<id>`) puts that poll first.
- **Swipe pager:** the feed is one fixed screen. Swipe up for the next poll, down for the
  previous one (the card follows your finger). A long poll scrolls inside its card first. The page
  never scrolls, so there's no accidental pull-to-refresh. On desktop: ↓/↑ or `j`/`k`.
- **One-tap voting:** results stay hidden until you vote. The tap responds instantly: your pick
  locks in and the bars fill in as soon as the server answers. The database enforces one vote per
  person.
- **Sign in at first vote:** the first time a signed-out visitor taps an answer, the "Lock in your
  pick" sheet slides up. After Google sign-in they land back on the poll with their vote counted
  and the confetti playing.
- **Animated results:** bars grow in from the left (900ms, 80ms apart), percentages pop,
  "You're with the X%!" appears with a confetti burst, and buttons sink when pressed. All motion
  stops when the phone's "reduce motion" setting is on.
- **Design tokens:** colours, fonts (Bricolage Grotesque and DM Sans), outlines, hard shadows and
  corner radii are CSS variables in `src/app/globals.css`.
- **PWA basics:** web app manifest, app icon, theme colour.
- **Share links:** every poll has its own link, `/p/<id>`. WhatsApp, X and other apps show a
  preview card in the poster style with the question, the answers and the vote count, never the
  result. The Share button opens a sheet with WhatsApp, X, the phone's share menu and Copy link;
  links are tagged `?src=whatsapp|x|native|copy`. Each signed-in person counts once per poll
  toward `share_count` (for the leaderboard).
- **Live updates:** while a poll is on screen, its numbers refresh every 5 seconds and the bars
  slide to the new values (before you vote, only the total moves). Every 45 seconds the feed checks
  for newly posted polls and shows a "Fresh polls ↑" pill; tapping it reloads the feed. Nothing
  runs while the tab is hidden. This is simple polling; Supabase Realtime can replace it once
  traffic grows.
- **Poll formats:** besides classic polls there are **hot takes** (a bold statement, Agree /
  Disagree, with a spice meter showing how split people are and a "Settle this" share button when
  it's close) and **mystery polls** (people see a teaser like "Pick a colour" and the answers; the
  real question stays on the server until they vote, then it's revealed). Anyone can post one of
  these a day. Docchi's own polls show a **verified** tick, in the app and on link previews.
- **Create poll:** question (up to 140 characters), 2 to 4 answers (up to 40 each), closes after
  1, 3 or 7 days, with a live preview. Anyone signed in can post up to 5 polls in 24 hours. The
  first poll also picks a username: a free one is prefilled from the Google name, it's checked as
  you type, and a taken name comes with free suggestions to tap. Unfinished drafts survive a
  reload or a trip through sign-in. After posting you land on your poll with a nudge to share it.
- **Profile:** lilac banner, avatar (Google photo or initial), @username with Edit (live
  availability check and suggestions; once a week), stat tiles (polls made, votes got, shares), and
  **My polls / Voted** tabs with mini result bars. Your own polls have Share, Make link-only / Show
  in feed, and Delete (with a confirm).
- **Usernames:** every Google account gets a starting username made from its Google name (or
  email). The first time someone opens the app signed in, a **"Pick your @name"** sheet asks them
  to keep it or change it (live check, free suggestions). It can't be skipped. After that, names
  can be changed on the profile once a week. Anonymous guests from the first release keep
  `guest_…` names and can't use circles.
- **Circle (Instagram Close Friends style, with requests):** everyone has a profile at
  `/u/<username>` with their public polls and an **Ask to join circle** button; that link is also
  their circle invite link. You accept or decline requests (a badge on the Profile tab shows how
  many are waiting), remove people, and sort your circle into **groups** such as Family or Office.
  It's one-way: being in my circle lets you see my circle polls, not the other way round. Search people by username; block someone to cut both directions. Limits: 500 people and
  10 groups per circle, 50 requests a day.
- **Circle polls:** "Who can see it" on the + screen is **Everyone / My circle / Only with link**.
  My circle goes to the whole circle or just the groups you tick (Family, Office…). Circle polls
  stay out of Trending and New and show in the **Circle** tab (with public polls from the circles
  you're in). Before voting: "Your pick is visible to @x's circle"; after voting: "@priya and 2 more
  picked this too" and who picked what. Anyone else who opens the link sees a locked "This poll is
  for @x's circle" card with Ask to join, and can't vote; link previews show only who it's from.
- **Private polls:** a poll can be for **Everyone** (in the feed) or **Only with the link**. A
  link-only poll never shows in the feed; it's on the creator's profile and in **Voted** for people
  who voted on it, and anyone else can open it only from its link. Chosen on the + screen, changeable later.
- **Deleting:** the creator can delete a poll. It disappears everywhere (a shared link shows "That
  poll isn't available anymore"), but the row stays in the database for moderation review.
- Leaders is a placeholder page for now.
- **Report:** the ⋯ on a poll card, or Report on someone's profile, opens a sheet with a reason
  (hate, private info, sexual, violence, spam, illegal, other). Signed-in accounts only, up to 20
  a day, anonymous to everyone else. A poll that **3 different people** report hides itself until
  an admin looks at it.
- **Admin (`/admin`):** for accounts with `profiles.is_admin`. **Reports** lists what's waiting
  (auto-hidden polls first) with the full poll, who posted it and their report history:
  Remove poll, Keep / Dismiss, or Ban (they can't vote, post or report, and all their polls are
  hidden). **Done** lists recent actions with Undo. **Metrics** shows visitors, votes, % of
  visitors who vote, votes per session, share rate and D1/D7 retention against the launch targets,
  plus a table by day.
- **Phone notifications (web push):** Profile → Notifications → Turn on. Then a switch for each
  kind: **votes** on your polls (at 10, 25, 50, 100…), **circle** (requests, yeses, new circle
  polls), **results** (when a poll you voted on or made closes) and **Poll of the Day** (9am).
  Quiet 11pm–8am India time, at most 8 a day, and tapping one opens the poll. Works on Android and
  desktop browsers; on iPhone, only after adding Docchi to the Home Screen (iOS 16.4+), and the
  card says so. Signing out stops that phone getting your notifications.
- **Terms, Privacy and Community guidelines** at `/terms`, `/privacy`, `/guidelines`, linked from
  the sign-in sheet, the + screen and the bottom of Profile. Set `NEXT_PUBLIC_CONTACT_EMAIL` to
  show a contact address on them.

**Voting needs a Google account.** Anyone can browse; voting requires sign-in (one tap with
Google). Guest accounts from the first release can still browse. When a guest signs in with Google,
Google is linked to the guest account, so it keeps the same user id and its earlier votes.

**Demo mode.** Without Supabase keys the app runs on the sample polls from the design canvas.
Votes are kept in memory only, and a banner says so.

## Run it

```bash
npm install
cp .env.example .env.local   # leave it empty for demo mode
npm run dev                  # http://localhost:3000
```

Checks: `npm run lint`, `npm run typecheck`, `npm run build`.

## Supabase setup (free tier)

### 1. Create the project

1. Sign in at [supabase.com](https://supabase.com) and create a **New project**.
2. Pick the region closest to your users (for India, **Mumbai / ap-south-1**).
3. Save the database password somewhere safe. You only need it for the CLI.

### 2. Create the tables and add the starter polls

The simplest way is the **SQL Editor** in the Supabase dashboard:

1. Open **SQL Editor → New query**, paste all of
   `supabase/migrations/20261023000000_init.sql`, and click **Run**.
2. Do the same with each later file in `supabase/migrations/`
   (`20261024000000_google_sign_in.sql`, `20261025000000_feed_paging.sql`,
   `20261026000000_create_poll.sql`, `20261027000000_shares.sql`,
   `20261028000000_poll_formats.sql`, `20261029000000_profile_privacy.sql`,
   `20261030000000_circles.sql`, `20261031000000_usernames.sql`, `20261101000000_circle_polls.sql`,
   `20261102000000_scale.sql`, `20261103000000_feed_voted_last.sql`,
   `20261104000000_safety_metrics.sql`, `20261105000000_push.sql`, …), in date order,
   each one once.
3. Open another new query, paste `supabase/seed.sql`, and click **Run**. This adds 12 starter
   polls, with "Tea or coffee" as today's Poll of the Day. You can run it again safely: it skips
   polls that already exist.

Or use the Supabase CLI:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>   # the ref is in the project URL
npx supabase db push                                  # applies supabase/migrations
# then run supabase/seed.sql in the SQL Editor
```

**Starter pack (before the friends beta):** run `supabase/starter_pack.sql` once in the SQL
Editor. It adds 49 more verified system polls (61 in all), mixing classic polls, hot takes and
mystery polls:
- a Poll of the Day for each of the next 14 days (unlocks at 00:00 India time, open 3 days);
- one new poll each morning for 15 days (09:00 India time, open 7 days), so the New tab and the
  "Fresh polls" pill stay alive;
- 20 evergreen polls, live now and open for 30 days.

It also keeps the original `seed.sql` polls open for 30 more days. It's safe to re-run, and dates
count from the day you run it. To write your own, copy a row in the `pack` list.

### 3. Google sign-in

**In Google Cloud** ([console.cloud.google.com](https://console.cloud.google.com)):

1. Create a project (for example "Docchi"), or pick an existing one.
2. **APIs & Services → OAuth consent screen** (called **Google Auth Platform** in newer
   consoles): user type **External**, app name **Docchi**, your support email, and the
   `openid`, `email` and `profile` scopes. While it's in **Testing**, only the test users you add
   can sign in. Click **Publish app** when you're ready for everyone.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type
   **Web application**:
   - **Authorized JavaScript origins:** `https://dochhi.vercel.app` (and `http://localhost:3000`
     for local development)
   - **Authorized redirect URIs:** `https://<project-ref>.supabase.co/auth/v1/callback`
     (Supabase shows this exact address on its Google provider page)
4. Copy the **Client ID** and **Client secret**.

**In Supabase:**

1. **Authentication → Sign In / Providers → Google:** turn it on, paste the Client ID and
   Client secret, and save.
2. On the same page, turn on **Allow manual linking**. This lets a guest account link Google
   and keep its votes.
3. **Authentication → URL Configuration:**
   - **Site URL:** `https://dochhi.vercel.app`
   - **Redirect URLs:** add `https://dochhi.vercel.app/auth/callback`,
     `https://*.vercel.app/auth/callback` (preview deployments) and
     `http://localhost:3000/auth/callback`
4. Once Google sign-in works, turn **off** **Allow anonymous sign-ins**. The app no longer creates
   guest accounts, and the database refuses votes from them anyway.

**CAPTCHA.** Google sign-in is protected by Google, so CAPTCHA isn't needed while Google is the
only way in and anonymous sign-ins are off. Add it before phone sign-in ships. Turning on
**Authentication → Attack Protection → CAPTCHA** also needs a small app change (a Turnstile
widget whose token is sent with sign-in), so do both together, or sign-ins will fail.

### 4. Connect the app

1. Open the project's **Connect** button (or **Project Settings → Data API** and **API Keys**).
2. Copy the **Project URL** and the **anon** key (newer projects call it the **publishable** key,
   starting with `sb_publishable_`). Both are safe to use in the browser, because row level
   security protects the data.
3. Put them in `.env.local`:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon or publishable key>
   ```

   The URL is just `https://<project-ref>.supabase.co`, with no `/rest/v1` and no slash at the
   end. The project ref is the last part of the dashboard address.

4. Restart `npm run dev`. The demo banner disappears and votes are now saved.

Never put the **service_role** (secret) key in this app or in any `NEXT_PUBLIC_` variable.

**Make yourself an admin** (once, in the SQL Editor), then open `/admin` (also linked at the
bottom of your Profile):

```sql
update public.profiles set is_admin = true where username = 'your_username';
```

### 5. Deploy (Vercel)

Import the repo on [vercel.com](https://vercel.com), add the same two environment variables (plus,
optionally, `NEXT_PUBLIC_SITE_URL=https://dochhi.vercel.app` so link previews always use that
address; otherwise Vercel's production address is used), and
deploy. Vercel warns about the `NEXT_PUBLIC_` prefix on values saved as private: set their type to
**Config** instead, since both are meant to be public. After changing a variable, **Redeploy**;
the values are baked in at build time. Then set up the Supabase URL Configuration as in step 3.

### 6. Phone notifications

1. **Make the keys**, on any computer with Node: `npx web-push generate-vapid-keys`. It prints a
   public and a private key. Also make a long random secret: `openssl rand -hex 32`.
2. **Vercel → Settings → Environment Variables**, then redeploy:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | the public key |
   | `VAPID_PRIVATE_KEY` | the private key (never `NEXT_PUBLIC_`) |
   | `VAPID_SUBJECT` | `mailto:` plus an address you read, e.g. `mailto:you@example.com` |
   | `PUSH_CRON_SECRET` | the random secret |

3. **Supabase → Database → Extensions:** turn on **pg_net** (pg_cron is already on).
4. **SQL Editor:** run `supabase/migrations/20261105000000_push.sql`, then, with your app's address
   and the same secret:

   ```sql
   select public.schedule_push('https://dochhi.vercel.app', '<PUSH_CRON_SECRET>');
   ```

   Every 2 minutes pg_cron calls `/api/push/run`, which collects new events into
   `notifications` and sends them. To check it's running:
   `select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;`
   and `select status_code, content from net._http_response order by created desc limit 5;`
   (expect `200` and something like `{"sent":0,"gone":0,"failed":0}`).

The card on Profile only appears once `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is set. Losing the private key
means everyone has to turn notifications on again, so keep a copy.

### Free tier limits to know about

- **A free project pauses after about a week with no activity.** You can restore it from the
  dashboard. During the friends beta, either keep traffic going or move to the Pro plan.
- The database is limited to 500 MB, which is far more than this MVP needs.
- Signed-in users count toward monthly active users (50,000 on the free tier).
- Phone sign-in by text message needs a paid SMS provider such as Twilio. Start with Google.

## How the data works

The data model is the one in `docs/poll-app-validation.md`. `users` is `public.profiles`, one row
per Supabase auth user, created automatically by a database trigger.

| Rule | Where it's enforced |
|------|---------------------|
| One vote per person | `votes` primary key `(poll_id, user_id)` |
| Only signed-in accounts vote | `cast_vote()` refuses signed-out and guest (anonymous) sessions |
| Poll rules (length, 2–4 distinct answers, 1/3/7 days, 5 per 24h) | `create_poll()` checks them all again |
| Usernames are unique, 3–20 of `a-z 0-9 _`, not reserved or rude | `username_problem()`, used by `check_username()` and `create_poll()` |
| A mystery question stays hidden until you vote | `poll_cards()` returns `null` for it; `cast_vote()` reveals it |
| One hot take or mystery poll per person per day | `create_poll()` |
| Link-only polls stay out of feeds | `get_feed()` only picks public polls (Circle tab: circle polls you can see) |
| Only the creator can change visibility or delete | `set_poll_visibility()`, `delete_poll()` (soft delete: `deleted_at`) |
| Every Google account has a real username; circles refuse `guest_…` accounts | `handle_new_user()`, `pick_username()`, `request_circle()` |
| Circle requests need the owner's OK; groups only hold accepted members | `request_circle()`, `respond_request()`, `set_group_member()` |
| Blocking cuts both ways and stops new requests | `block_user()`, checked by `request_circle()`, `get_profile()`, `search_people()` |
| Circle polls: only the circle (or its chosen groups) sees, votes on and sees picks | `can_view_poll()`, used by `get_feed()`, `poll_cards()`, `cast_vote()`, `circle_picks()` |
| No reading polls around the rules | direct `select` on `polls` / `poll_options` is revoked; everything goes through the functions |
| Shares count once per person per poll | `shares` primary key + `record_share()`; signed-out shares aren't counted |
| Word filter | `blocked_terms` table (whole words, English + Hindi); add rows to extend it |
| Counters stay correct | `cast_vote()` saves the vote and bumps both counters in one transaction |
| Results hidden until you vote | Clients can't read `poll_options.vote_count` directly. `get_feed()` only returns counts once you've voted or the poll has closed |
| No direct writes from the browser | Inserts and updates are revoked for `anon` and `authenticated`. Writes go through database functions |
| Banned users and closed polls | Checked inside `cast_vote()` |
| Comments disappear after 24h | `expires_at`, filtered by row level security. Rows stay in the database so moderators can review them |
| Reports: signed-in only, 20 a day, one per person per poll; 3 reporters hide a poll | `report()` |
| Only admins see reports and metrics, or remove / ban | `require_admin()` in every `admin_…()` function; `reports`, `visits`, `mod_actions` aren't readable by clients |
| Banned accounts can't vote, post or report, and their polls are hidden | `admin_act('ban')`, checked by `cast_vote()`, `create_poll()`, `report()` |
| Push goes only to your own devices, only for things you can see | `save_push_subscription()` ties a phone to the signed-in account; `push_scan()` uses `can_view_poll()` for circle polls; subscriptions and the outbox aren't readable by clients |
| Only the app's sender can collect and send pushes | `push_collect()`, `push_gone()`, `push_test_targets()` need the `PUSH_CRON_SECRET` (stored hashed in `push_config`) |
| Data is deleted on schedule (as the Privacy page says) | `purge_old_records()` daily via pg_cron: removed polls, old comments and resolved reports after 180 days, visits after 2 years |

**The feed** (`get_feed`) shows open polls, 30 per page ("load more" fetches the next page a few
cards before the end). On Trending and New, polls you haven't voted on come first, with today's
Poll of the Day on top of Trending; ones you've voted on follow at the end. **Trending** ranks by `polls.hot_score`, votes with a time
decay (Hacker News style). **New** is newest first.

**Keeping it fast as tables grow.** Every list picks its ~30 poll ids straight from an index
(`polls_hot_idx`, `polls_new_idx`, `polls_creator_idx`, `votes (user_id, created_at)`), then
`poll_cards()` builds just those cards, so a page costs the same at 50 polls or 5 million. Pages
continue from a cursor (each row's `cursor`, passed back as `after`) instead of an offset, so
deep pages stay fast and nothing repeats. `hot_score` is refreshed every 5 minutes by
`refresh_hot_scores()`: by **pg_cron** if it's enabled (Supabase: **Database → Extensions →
pg_cron**, then run the scale migration's last block again, or
`select cron.schedule('docchi-hot-scores', '*/5 * * * *', 'select public.refresh_hot_scores()');`),
otherwise by the first feed load that finds it stale. New polls get a score on insert, so they
show up straight away. Username search uses a trigram index (`pg_trgm`). A shared link (`/?poll=<id>`) puts that poll first, even
after it has closed (`get_poll`).

**Metrics** come from one `visits` row per browser per day (a random id in localStorage, sent by
`track_visit()` when the app opens or comes back after 30 minutes), plus the votes, shares, polls
and profiles tables. Finished days are counted once into `metrics_daily`, so the admin page stays
fast as votes grow. The targets (from `docs/poll-app-validation.md`): ≥60% of visitors vote, ≥8
votes per session, 3–5% share rate, D1 ≥30%, D7 ≥12%.

**Poll of the Day** is the system poll whose `featured_on` is today's date in India time
(`Asia/Kolkata`). To schedule one, insert a system poll with a future `featured_on`; it stays
hidden until that day.

## Project layout

```
src/app/            routes, layout (fonts, metadata), globals.css (tokens + motion), manifest, icon
src/app/auth/       callback: where Google sends people back; casts the pick made before sign-in
src/components/     Feed, PollCard, SignInSheet, AuthCallback, AccountCard, BottomNav, Logo, icons
src/lib/            polls.ts (Supabase calls + demo mode), auth.ts, supabase.ts, format.ts, types.ts
supabase/           migrations/ (schema, row level security, functions), seed.sql
docs/               product validation and design handoff
```

## Next in the build order

1. Weekly leaderboard job (public polls only)
2. CAPTCHA (Cloudflare Turnstile) on sign-in, and rate limits on circle requests and shares
3. Admin: schedule system polls / Poll of the Day
