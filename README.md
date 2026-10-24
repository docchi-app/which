# Docchi

**Docchi. Which one?** A light, fun poll app: tap a side, then see where everyone else landed.
It's a mobile-first PWA built with Next.js and Supabase.

Product and design background: [`docs/HANDOFF-docchi.md`](docs/HANDOFF-docchi.md) and
[`docs/poll-app-validation.md`](docs/poll-app-validation.md). The screens are on the design canvas
linked in the handoff.

## What's built so far

The first slice of the build order:

- **Feed:** For you (trending), New and Friends tabs, Poll of the Day pinned on top, a card stack with Next and Skip,
  and an "all caught up" card at the end. A shared link (`/?poll=<id>`) puts that poll first.
- **Swipe pager:** the feed is one fixed screen. Swipe up for the next poll, down for the
  previous one (the card follows your finger). A long poll scrolls inside its card first. The page
  never scrolls, so there's no accidental pull-to-refresh. On desktop: ↓/↑ or `j`/`k`.
- **One-tap voting:** results stay hidden until you vote. The tap responds instantly: your pick
  locks in and the bars fill in as soon as the server answers. The database enforces one vote per
  person.
- **Vote first, sign in later:** a new visitor votes straight away as a guest (a Supabase anonymous
  account) and sees the results, with their own pick shown in them. A guest's votes are stored but
  left out of every total and the leaderboard until they sign in with Google; linking Google keeps
  the same account, so their votes join the totals then (if that Google account already had
  Docchi, `/auth/callback` casts the guest's picks again as that account). Results show "Your vote
  counts once you sign in", and after a guest's 3rd vote a "Make your votes count" sheet asks once.
  If guest sign-ins are switched off, the first tap opens the old "Lock in your pick" sheet.
- **First visit:** a one-line welcome above the tabs says what Docchi is, until it's dismissed or
  the first vote. An unvoted card with fewer than 10 votes says "Be the first to vote" / "Be one of
  the first to vote" instead of a tiny count, and a poll with no comments shows the bubble without
  a "0".
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
  `guest_…` names and can't add friends.
- **Friends (two-way):** a **Friends** tab in the bottom nav (`/friends`) with an **Invite friends**
  link (`/u/<name>?invite=<code>`: whoever opens it, signed in, becomes your friend at once),
  username search, friend requests (Accept / Decline), **People you might know** (mutual friends,
  people whose polls you vote on, this week's top creators), your friends (Unfriend, and tick them
  into **lists** such as Family or Office) and requests you sent. Every profile (`/u/<username>`)
  has **Add friend** / Request sent / Accept / ✓ Friends. Adding someone who already asked you makes
  you friends straight away. Block someone to unfriend and stop new requests. Limits: 500 friends,
  10 lists, 50 requests a day. In the database friendships live in the old circle tables
  (`circle_members`, stored both ways once accepted); the old circle RPC names still work.
- **Friends-only polls:** "Who can see it" on the + screen is **Everyone / Friends / Only with
  link**. Friends goes to all your friends or just the lists you tick. Before voting: "@x's friends
  can see your pick"; after voting: "@priya and 2 more picked this too" and who picked what. Anyone
  else who opens the link sees a locked "This poll is for @x's friends" card with **Add @x as a
  friend**, and can't vote; link previews show only who it's from.
- **One feed:** **For you** (trending) and **New** show every live poll you can see: public polls,
  your friends' friends-only polls, your own, and link-only polls you've opened or voted on (opening
  one records it in `poll_access`). The **Friends** tab narrows it to polls from friends.
- **Friends voted:** after you vote on a public or link poll, "@priya and 2 friends voted" with
  their faces. Never what they picked (`friends_voted()`).
- **Bell:** top right of the feed, with the friend-request count or a dot for new votes and comments
  on your polls. It opens **Activity** (`/activity`): requests to accept or decline, and each of
  your polls with news ("+5 votes · 1 comment"), linking to the poll.
- **Private polls:** a poll can be for **Everyone** (in the feed) or **Only with the link**. A
  link-only poll is never in anyone's feed until they open its link; then it shows in theirs. Chosen on the + screen, changeable later.
- **Deleting:** the creator can delete a poll. It disappears everywhere (a shared link shows "That
  poll isn't available anymore"), but the row stays in the database for moderation review.
- **Leaders (weekly):** Monday–Sunday, India time. **Top creators** by votes their public polls got
  this week (podium for the top 3, then the list), **Hottest polls** by votes this week, last
  week's champ on top, your own rank pinned at the bottom, and a Last week view. Votes on your own
  poll, on Docchi's polls, from guests who haven't signed in, from banned accounts or from accounts
  under a day old don't count. Arriving while this week's board is still empty shows last week's
  instead.
- **Comments:** tap the 💬 count on a card. You can read and write once you've voted (or the poll
  has closed, or it's yours), so comments never spoil a vote or a mystery question. Each shows the
  writer's pick in that answer's colour; 200 characters; gone after 24 hours. Delete your own, or
  any on your poll; report one (3 reporters hide it until an admin looks). Word filter, 5 per poll
  per 10 minutes and 30 an hour. Poll creators get a batched "3 new comments" push (Settings →
  Notifications → Comments), which opens the comments.
- **Report:** the ⋯ on a poll card, or Report on someone's profile, opens a sheet with a reason
  (hate, private info, sexual, violence, spam, illegal, other). Signed-in accounts only, up to 20
  a day, anonymous to everyone else. A poll that **3 different people** report hides itself until
  an admin looks at it.
- **Admin (`/admin`):** for accounts with `profiles.is_admin`. **Reports** lists what's waiting
  (auto-hidden polls first) with the full poll, who posted it and their report history:
  Remove poll, Keep / Dismiss, or Ban (they can't vote, post or report, and all their polls are
  hidden). **Schedule** shows Poll of the Day for the next three weeks, flags empty days, and adds, edits
  or removes one (classic, hot take or mystery; open 1–7 days; goes live at midnight India time).
  **Done** lists recent actions with Undo. **Metrics** shows visitors, votes, % of
  visitors who vote, votes per session, share rate and D1/D7 retention against the launch targets,
  plus a table by day.
- **Tips, one at a time:** a small dark bubble beside the thing it explains, shown once, at the
  moment it's useful: + after your 2nd vote, 💬 when you vote on a poll that has comments, Leaders
  after your first poll (or 6 votes), the Friends tab after 8 votes, the bell when your polls have
  news. Never more than one every 2 minutes, never while a sheet is open, never blocks a tap; any
  tap, scroll or 7 seconds hides it (`src/lib/tips.ts`, `TipLayer`).
- **What's new on your polls:** a dot on the bell when your polls got votes or comments since you
  last looked (friend requests show a number on the bell and the Friends tab), then Activity and
  Profile → My polls show a
  "Since your last visit: +14 votes · 3 comments" line and a chip on each poll with news. It's
  marked seen after a moment on screen (`my_activity()` / `mark_activity_seen()`, stored per account).
- **Settings (⚙︎ on Profile):** notifications, the app (Home Screen), account (Admin, Sign out) and
  the policies, so Profile stays about your polls.
- **Phone notifications (web push):** a slim "Get notified → Turn on" row on Profile while they're
  off on that phone (✕ hides it for a month); once on, it disappears. Settings → Notifications has a
  switch for each kind: **votes** on your polls (at 10, 25, 50, 100…), **friends** (friend requests, new friends,
  friends-only polls), **results** (when a poll you voted on or made closes) and **Poll of the Day** (9am).
  Quiet 11pm–8am India time, at most 8 a day, and tapping one opens the poll. Works on Android and
  desktop browsers; on iPhone, only after adding Docchi to the Home Screen (iOS 16.4+), and the
  app says so. Signing out stops that phone getting your notifications.
- **Get the app (Home Screen):** a step-by-step sheet. On iPhone: Share → Add to Home Screen →
  Add, with an arrow pointing at Safari's Share button (or at the top for Chrome on iPhone),
  opened from Profile's notifications row (How?) or Settings. Inside Instagram, Facebook, WhatsApp and
  other in-app browsers: how to open Docchi in Safari or Chrome, plus Copy link. On Android: a
  real **Install Docchi** button when Chrome offers it (Settings → The app), otherwise ⋮ →
  Install app. After someone's 3rd vote in a browser it offers itself once; "Not now" waits a
  week. iPhone can't show an install prompt like Android: Apple doesn't allow it for websites.
- **Terms, Privacy and Community guidelines** at `/terms`, `/privacy`, `/guidelines`, linked from
  the sign-in sheet, the + screen and Settings. Set `NEXT_PUBLIC_CONTACT_EMAIL` to
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
   `20261104000000_safety_metrics.sql`, `20261105000000_push.sql`, `20261106000000_push_fixes.sql`, `20261107000000_leaders_schedule.sql`,
   `20261108000000_comments.sql`, `20261109000000_rate_limits.sql`,
   `20261110000000_activity.sql`, `20261111000000_guest_votes.sql`, `20261112000000_friends.sql`, …),
   in date order,
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
4. On the same page, turn **on** **Allow anonymous sign-ins**. Visitors vote as guests before
   signing in; their votes only count once they link Google (step 2). With it off, the app asks
   for Google at the first vote instead.

**Show "Docchi", not the Supabase address, on Google's screen.** By default Google sends people
back to Supabase, so its screen says "Sign in to <project-ref>.supabase.co". To run sign-in
through this site instead:

1. On the same OAuth client in Google Cloud, add the redirect URI
   `https://dochhi.vercel.app/auth/google/callback` (keep the Supabase one too; guest
   linking still uses it). Add `http://localhost:3000/auth/google/callback` for local development.
2. In Vercel, add `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (the Client ID; it's public) and
   `GOOGLE_CLIENT_SECRET` (the Client secret; server-only, mark it **Sensitive**). Redeploy.
3. In Google Auth Platform → **Branding**, fill in the app name, logo, home page, privacy and terms
   links. Google shows "Sign in to dochhi.vercel.app" straight away, and the app name **Docchi**
   once the brand is verified.

The sign-in button then opens `/auth/google`, which sends the viewer to Google; Google returns to
`/auth/google/callback`, which swaps the code for an ID token, signs in to Supabase with it
(`signInWithIdToken`) and lands on `/auth/callback` as before. Leave the two variables empty and
sign-in goes through Supabase as it always has. Preview deployments use the Supabase route unless
their address is also added as a redirect URI.

**CAPTCHA.** Google sign-in is protected by Google, so CAPTCHA isn't needed while Google is the
only way in. Guest (anonymous) sign-ins are on, but a guest's votes never count until they link
Google, and Supabase limits new guest accounts per IP address. Add it before phone sign-in ships. Turning on
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

**Make yourself an admin** (once, in the SQL Editor), then open `/admin` (also in
Settings → Account):

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

**If "Send me a test" fails,** the card says why:

- *the secret doesn't match*: run `schedule_push` again with exactly the `PUSH_CRON_SECRET` value
  from Vercel (stray spaces are ignored).
- *the push service refused it*: `VAPID_PRIVATE_KEY` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` aren't
  the same pair. Fix them in Vercel and redeploy; people may need to turn notifications off and on.
- Vercel → your project → **Logs** shows `push test:` / `push run:` / `push send failed:` lines
  with details.

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
| Only Google accounts' votes count | `cast_vote()` stores a guest's vote with `counted = false` and leaves the totals alone; linking Google runs `count_guest_votes()`; the leaderboard reads only counted votes |
| Poll rules (length, 2–4 distinct answers, 1/3/7 days, 5 per 24h) | `create_poll()` checks them all again |
| Usernames are unique, 3–20 of `a-z 0-9 _`, not reserved or rude | `username_problem()`, used by `check_username()` and `create_poll()` |
| A mystery question stays hidden until you vote | `poll_cards()` returns `null` for it; `cast_vote()` reveals it |
| One hot take or mystery poll per person per day | `create_poll()` |
| Feeds only show polls you can see | `get_feed()` uses `in_feed()`: public polls, your own, friends-only polls `can_view_poll()` allows, and link polls in your `poll_access` |
| Only the creator can change visibility or delete | `set_poll_visibility()`, `delete_poll()` (soft delete: `deleted_at`) |
| Every Google account has a real username; circles refuse `guest_…` accounts | `handle_new_user()`, `pick_username()`, `request_circle()` |
| Friend requests need the other person's OK (or their invite link); friendships are two-way; lists only hold friends | `request_circle()`, `respond_request()`, `make_friends()`, `accept_invite()`, `set_group_member()` |
| Blocking cuts both ways and stops new requests | `block_user()`, checked by `request_circle()`, `get_profile()`, `search_people()` |
| Friends-only polls: only friends (or the chosen lists) see, vote on and see picks; on other polls friends see only that you voted | `can_view_poll()`, used by `get_feed()`, `poll_cards()`, `cast_vote()`, `circle_picks()`; `friends_voted()` returns names, never picks |
| No reading polls around the rules | direct `select` on `polls` / `poll_options` is revoked; everything goes through the functions |
| Shares count once per person per poll | `shares` primary key + `record_share()`; signed-out shares aren't counted |
| Word filter | `blocked_terms` table (whole words, English + Hindi); add rows to extend it |
| Counters stay correct | `cast_vote()` saves the vote and bumps both counters in one transaction |
| Results hidden until you vote | Clients can't read `poll_options.vote_count` directly. `get_feed()` only returns counts once you've voted or the poll has closed |
| No direct writes from the browser | Inserts and updates are revoked for `anon` and `authenticated`. Writes go through database functions |
| Banned users and closed polls | Checked inside `cast_vote()` |
| Comments disappear after 24h | `expires_at`, filtered in `get_comments()`. Rows stay in the database so moderators can review them (the purge removes them after 180 days) |
| Rate limits (app requests only; the SQL Editor isn't limited) | Triggers: votes 120 per 10 min and 1,500 a day; circle requests 20 per 10 min (and 50 a day); shares 60 an hour; blocks 30 an hour; groups 20 an hour; group members 300 an hour. Polls, comments, reports and usernames have their own limits. Over a limit → `docchi:slow_down` |
| Comments only for people who voted (or a closed poll, or its creator), and circle polls stay in the circle | `can_read_comments()` in `get_comments()` / `post_comment()`; the comments table isn't readable by clients |
| Reports: signed-in only, 20 a day, one per person per poll; 3 reporters hide a poll | `report()` |
| Only admins see reports and metrics, or remove / ban | `require_admin()` in every `admin_…()` function; `reports`, `visits`, `mod_actions` aren't readable by clients |
| Banned accounts can't vote, post or report, and their polls are hidden | `admin_act('ban')`, checked by `cast_vote()`, `create_poll()`, `report()` |
| Push goes only to your own devices, only for things you can see | `save_push_subscription()` ties a phone to the signed-in account; `push_scan()` uses `can_view_poll()` for circle polls; subscriptions and the outbox aren't readable by clients |
| Only the app's sender can collect and send pushes | `push_collect()`, `push_gone()`, `push_test_targets()` need the `PUSH_CRON_SECRET` (stored hashed in `push_config`) |
| Data is deleted on schedule (as the Privacy page says) | `purge_old_records()` daily via pg_cron: removed polls, old comments and resolved reports after 180 days, visits after 2 years |

**The feed** (`get_feed`) shows open polls, 30 per page ("load more" fetches the next page a few
cards before the end). On For you and New, polls you haven't voted on come first, with today's
Poll of the Day on top of Trending; ones you've voted on follow at the end. **Trending** ranks by `polls.hot_score`, votes with a time
decay (Hacker News style). **New** is newest first.

**Share previews are instant.** The share sheet draws the link-preview card itself from data the
phone already has (`SharePreview`, same layout rules as the server image via `src/lib/preview.ts`),
so it appears the moment the sheet opens. Meanwhile it quietly asks the server to build that poll's
link page and preview image (`warmShareCard`), so they're cached before WhatsApp or X fetch them.
The image route draws each poll once on first request and caches it (redrawn every 5 minutes):
first request ~200–400 ms, cached ~5–10 ms, the same at any number of polls.

**Comments stay fast too:** `comments_live_idx` (poll, newest first, not hidden) means a card's
comment count reads only the index, and `get_comments` takes the newest 120 from it before the
block filter. With 1M comments (20 polls with 5,000 live each), opening a busy poll's comments went
from 17 ms to 3.5 ms and Trending from 20 ms to 8.5 ms.

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
(`Asia/Kolkata`). Schedule them in **Admin → Schedule** (`admin_schedule_poll()`); each stays hidden
until its day.

**The leaderboard** is stored in `leader_scores` (top 100 per board per week) and rebuilt every
10 minutes by pg_cron (`docchi-leaders`), or by the first visit after 15 minutes without it. Past
weeks are kept, so last week's champ is a lookup.

## Project layout

```
src/app/            routes, layout (fonts, metadata), globals.css (tokens + motion), manifest, icon
src/app/auth/       google: sign in with Google on this domain; callback: casts the pick made before sign-in
src/components/     Feed, PollCard, SignInSheet, AuthCallback, AccountCard, BottomNav, Logo, icons
src/lib/            polls.ts (Supabase calls + demo mode), auth.ts, supabase.ts, format.ts, types.ts
supabase/           migrations/ (schema, row level security, functions), seed.sql
docs/               product validation and design handoff
```

## Next in the build order

1. CAPTCHA (Cloudflare Turnstile) on sign-in
