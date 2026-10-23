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
- **Live updates:** while a poll is on screen, its numbers refresh every 5 seconds and the bars
  slide to the new values (before you vote, only the total moves). Every 45 seconds the feed checks
  for newly posted polls and shows a "Fresh polls ↑" pill; tapping it reloads the feed. Nothing
  runs while the tab is hidden. This is simple polling; Supabase Realtime can replace it once
  traffic grows.
- **Create poll:** question (up to 140 characters), 2 to 4 answers (up to 40 each), closes after
  1, 3 or 7 days, with a live preview. Anyone signed in can post up to 5 polls in 24 hours. The
  first poll also picks a username: a free one is prefilled from the Google name, it's checked as
  you type, and a taken name comes with free suggestions to tap. Unfinished drafts survive a
  reload or a trip through sign-in. After posting you land on your poll with a nudge to share it.
- Leaders is a placeholder page for now. Profile shows who's signed in, with sign-out.

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
   `20261026000000_create_poll.sql`, …), in date order,
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

### 5. Deploy (Vercel)

Import the repo on [vercel.com](https://vercel.com), add the same two environment variables, and
deploy. Vercel warns about the `NEXT_PUBLIC_` prefix on values saved as private: set their type to
**Config** instead, since both are meant to be public. After changing a variable, **Redeploy**;
the values are baked in at build time. Then set up the Supabase URL Configuration as in step 3.

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
| Word filter | `blocked_terms` table (whole words, English + Hindi); add rows to extend it |
| Counters stay correct | `cast_vote()` saves the vote and bumps both counters in one transaction |
| Results hidden until you vote | Clients can't read `poll_options.vote_count` directly. `get_feed()` only returns counts once you've voted or the poll has closed |
| No direct writes from the browser | Inserts and updates are revoked for `anon` and `authenticated`. Writes go through database functions |
| Banned users and closed polls | Checked inside `cast_vote()` |
| Comments disappear after 24h | `expires_at`, filtered by row level security. Rows stay in the database so moderators can review them |

**The feed** (`get_feed`) shows open polls only, 30 per page ("load more" fetches the next page a
few cards before the end). Polls you haven't voted on come first, with today's Poll of the Day on
top; ones you've voted on go to the end. **Trending** ranks by votes with a time decay (Hacker News
style), computed when the feed loads; once traffic grows it should move to a score refreshed every
few minutes. **New** is newest first. A shared link (`/?poll=<id>`) puts that poll first, even
after it has closed (`get_poll`).

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

1. Create poll
2. Choose a username (everyone starts as `guest_…`) as part of the profile screen
3. Share previews (Open Graph image with live counts)
4. Comments that expire after 24h
5. Weekly leaderboard job
6. Admin panel and moderation
