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
- **One-tap voting:** results stay hidden until you vote. The database enforces one vote per
  person.
- **Animated results:** bars grow in from the left (900ms, 80ms apart), percentages pop,
  "You're with the X%!" appears with a confetti burst, and buttons sink when pressed. All motion
  stops when the phone's "reduce motion" setting is on.
- **Design tokens:** colours, fonts (Bricolage Grotesque and DM Sans), outlines, hard shadows and
  corner radii are CSS variables in `src/app/globals.css`.
- **PWA basics:** web app manifest, app icon, theme colour.
- Leaders, Profile and Create are placeholder pages for now.

**Voting without an account (for now).** The first vote quietly creates an anonymous Supabase
account. When Google sign-in arrives, the anonymous account is linked to Google and keeps the same
user id, so earlier votes carry over.

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
2. Open another new query, paste `supabase/seed.sql`, and click **Run**. This adds 12 starter
   polls, with "Tea or coffee" as today's Poll of the Day. You can run it again safely: it skips
   polls that already exist.

Or use the Supabase CLI:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>   # the ref is in the project URL
npx supabase db push                                  # applies supabase/migrations
# then run supabase/seed.sql in the SQL Editor
```

### 3. Turn on anonymous sign-ins

Go to **Authentication → Sign In / Providers** and switch on **Allow anonymous sign-ins**.
Without this, votes fail with "Anonymous sign-ins are disabled".

Before you share the app publicly, also turn on CAPTCHA (Cloudflare Turnstile) under
**Authentication → Attack Protection**. Otherwise bots can create anonymous accounts freely.

### 4. Connect the app

1. Open **Project Settings → API** (also reachable from the project's **Connect** button).
2. Copy the **Project URL** and the **anon** key (newer projects call it the **publishable** key,
   starting with `sb_publishable_`). Both are safe to use in the browser, because row level
   security protects the data.
3. Put them in `.env.local`:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon or publishable key>
   ```

4. Restart `npm run dev`. The demo banner disappears and votes are now saved.

Never put the **service_role** (secret) key in this app or in any `NEXT_PUBLIC_` variable.

### 5. Deploy (Vercel)

Import the repo on [vercel.com](https://vercel.com), add the same two environment variables, and
deploy. In Supabase, under **Authentication → URL Configuration**, set the **Site URL** to your
Vercel URL. Google sign-in will need this later.

### Free tier limits to know about

- **A free project pauses after about a week with no activity.** You can restore it from the
  dashboard. During the friends beta, either keep traffic going or move to the Pro plan.
- The database is limited to 500 MB, which is far more than this MVP needs.
- Anonymous users count toward monthly active users (50,000 on the free tier).
- Phone sign-in by text message needs a paid SMS provider such as Twilio. Start with Google.

## How the data works

The data model is the one in `docs/poll-app-validation.md`. `users` is `public.profiles`, one row
per Supabase auth user, created automatically by a database trigger.

| Rule | Where it's enforced |
|------|---------------------|
| One vote per person | `votes` primary key `(poll_id, user_id)` |
| Counters stay correct | `cast_vote()` saves the vote and bumps both counters in one transaction |
| Results hidden until you vote | Clients can't read `poll_options.vote_count` directly. `get_feed()` only returns counts once you've voted or the poll has closed |
| No direct writes from the browser | Inserts and updates are revoked for `anon` and `authenticated`. Writes go through database functions |
| Banned users and closed polls | Checked inside `cast_vote()` |
| Comments disappear after 24h | `expires_at`, filtered by row level security. Rows stay in the database so moderators can review them |

**Trending** ranks polls by votes with a time decay (Hacker News style), computed when the feed
loads. Once traffic grows it should move to a score refreshed every few minutes.

**Poll of the Day** is the system poll whose `featured_on` is today's date in India time
(`Asia/Kolkata`). To schedule one, insert a system poll with a future `featured_on`; it stays
hidden until that day.

## Project layout

```
src/app/            routes, layout (fonts, metadata), globals.css (tokens + motion), manifest, icon
src/components/     Feed, PollCard, BottomNav, Logo, icons, ComingSoon
src/lib/            polls.ts (Supabase calls + demo mode), supabase.ts, format.ts, types.ts
supabase/           migrations/ (schema, row level security, functions), seed.sql
docs/               product validation and design handoff
```

## Next in the build order

1. Sign-in sheet ("Lock in your pick") with Google, linking the anonymous account
2. Create poll
3. Share previews (Open Graph image with live counts)
4. Comments that expire after 24h
5. Weekly leaderboard job
6. Admin panel and moderation
