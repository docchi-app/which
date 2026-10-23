# Poll App (Lite Social): Idea Validation and MVP

**The idea:** A light social app built around polls. Users create polls and others vote. The
system seeds interesting polls at the start so the app isn't empty. Comments disappear
automatically after some time. A leaderboard lists the users whose polls went viral. It's
built for fun, with no monetization yet.

---

## 1. Verdict

| Dimension | Rating | Notes |
|-----------|--------|-------|
| Functional | 🟢 Clear and simple | The core loop (see a question → tap → see results) is instantly understood. |
| Technical | 🟢 Easy | It's standard CRUD plus counters. Nothing exotic. |
| Feasibility | 🟢 High | One developer can ship it in **3–5 weeks** for almost no running cost. |
| Usability | 🟢 Good if voting is one tap | Friction anywhere (sign-up before voting, slow results) kills it. |
| Retention / market | 🟠 The real risk | Poll apps spike and fade (Polar, Wishbone). Successful ones had a strong hook: tbh and Gas were polls *about your friends*. Polls already exist inside X, Instagram, WhatsApp, Reddit. |
| Safety | 🟠 Underestimated | It's an app full of user-generated content with disappearing comments, so moderation is mandatory, not optional. |

**Bottom line:** Easy to build and fine to build for fun. The thing to learn is **whether people
come back**, not whether it can be built. Design the MVP to test that.

---

## 2. Functional validation

### What works
- **System-seeded polls** solve the empty-app problem. Make it a **"Poll of the Day"** plus a
  steady stream of trending topics. A daily poll is the simplest habit loop.
- **Disappearing comments** keep the vibe light and lower the stakes of commenting.
- **The leaderboard** gives creators a reason to make good polls and share them.

### What needs defining
| Topic | Decision needed | Suggestion |
|-------|-----------------|------------|
| What is "viral"? | A formula, or it's arbitrary and easy to game | Score = unique verified voters in the first 24–48 h, plus shares and comments. Reset **weekly**, with an all-time board as a bonus. |
| Results visibility | Before or after voting? | **After voting.** It avoids bias and makes curiosity the reason to vote. |
| Poll lifetime | Do polls close? | Default 24 h, 3 days, or 7 days. Closed polls stay viewable. |
| Comment TTL | How long? | 24 h, with a visible countdown so the disappearance isn't confusing. |
| Anonymity | Are votes public? | Votes anonymous, creators public (shown on the leaderboard). |
| Duplicate votes | One vote per person | Requires login to vote (guests can browse). |
| Changing a vote | Allowed? | No, or only within 1 minute. It keeps results meaningful. |

### Moderation is a must-have, even for a fun app
- App stores require **report, block, and a content filter** for user-generated content (Apple
  guideline 1.2, and Google Play has an equivalent).
- **Disappearing comments make moderation harder.** Hide them from users when they expire, but
  keep reported (and ideally all) comments in the back end for a short period so abuse can be
  reviewed. Many countries' laws require platforms to keep this data and respond to complaints,
  including India's IT Rules 2021.
- Use a basic profanity filter, rate limits on creating polls and comments, and an admin panel to
  remove content.

---

## 3. What the MVP looks like

### Goal
Prove one thing: **do people vote, share, and come back the next day?**

### Platform
**Mobile-friendly web app (PWA) first.** Every poll has a link, and the link is the growth engine:
it's shared to WhatsApp, Instagram, or X with a preview card ("Tea or Coffee? 1,204 votes"), and the
friend votes in the browser without installing anything. Build native apps only if retention is
proven.

### In scope
| # | Feature | Details |
|---|---------|---------|
| 1 | Sign in | Google sign-in or phone OTP. Browsing allowed without an account. |
| 2 | Feed | Two tabs: **Trending** and **New**. One poll card per screen, tap to vote. |
| 3 | Vote | One tap → animated result bars appear. |
| 4 | Create poll | Question (max 140 chars), 2–4 text options, duration (1/3/7 days). |
| 5 | Share | Native share sheet and an Open Graph preview image showing the question and live counts. |
| 6 | Comments | Plain text, max 200 chars, auto-hidden after 24 h with a countdown. |
| 7 | Leaderboard | Weekly top creators by viral score, with a link to their top poll. |
| 8 | Profile (minimal) | Username, avatar, polls created, total votes received. |
| 9 | Seeding / admin | Admin can create and schedule polls (Poll of the Day), remove content, and ban users. |
| 10 | Safety | Report poll or comment, block user, profanity filter, rate limits. |

### Out of scope (later)
Follow/friends, notifications beyond basic, image or video polls, DMs, hashtags and search,
AI-generated polls, badges or streaks, monetization.

### Success metrics (after ~4 weeks with real users)
| Metric | Healthy signal |
|--------|----------------|
| Votes per session | ≥ 8 |
| % of visitors who vote | ≥ 60% |
| Share rate (shares / polls viewed) | ≥ 3–5% |
| Polls created per 100 DAU | ≥ 5 (people want to create, not just consume) |
| D1 / D7 retention | ≥ 30% / ≥ 12% |

---

## 4. Technical design (MVP)

### Stack (fast and cheap)
- **Frontend:** Next.js (React) as a PWA, or Blazor/ASP.NET if the team prefers .NET.
- **Back end:** Supabase (Postgres, auth, realtime) or Firebase. Both have generous free tiers and
  give you live-updating results almost for free.
- **Hosting:** Vercel / Netlify / Azure Static Web Apps.

### Data model
```
users(id, username, avatar_url, created_at, is_banned)
polls(id, creator_id, question, closes_at, is_system, vote_count, share_count, created_at)
poll_options(id, poll_id, text, vote_count)
votes(poll_id, user_id, option_id, created_at)   -- PRIMARY KEY (poll_id, user_id)
comments(id, poll_id, user_id, text, created_at, expires_at, is_hidden)
reports(id, target_type, target_id, reporter_id, reason, created_at)
```

### Key implementation points
- **One vote per user:** the database's unique key on `(poll_id, user_id)` enforces it, so
  duplicates are impossible.
- **Fast counts:** keep running counters on `poll_options.vote_count`, updated in the same
  transaction as the vote insert (or via Redis if traffic grows). Don't run `COUNT(*)` on every view.
- **Disappearing comments:** filter `WHERE expires_at > now()` on read, plus a scheduled job that
  purges or archives expired rows. Firestore TTL policies or MongoDB TTL indexes do this natively.
- **Trending:** score = votes in the last N hours with time decay (Hacker News-style), recomputed
  every few minutes.
- **Leaderboard:** a weekly job (or materialized view) over polls created that week. Only count
  votes from accounts older than X hours to blunt bot farming.
- **Anti-abuse:** rate limits per user and IP, a CAPTCHA on sign-up if bots appear, and a check for
  sudden vote spikes from new accounts.
- **Share previews:** generate an Open Graph image per poll (e.g. `@vercel/og`).

### Effort and cost
| Item | Estimate |
|------|----------|
| Build (1 developer) | 3–5 weeks |
| Running cost at MVP scale | ~$0–25 / month on free or starter tiers |

---

## 5. Usability

- **Voting in one tap, no sign-up wall to browse.** Ask for sign-in only at the moment of the
  first vote (one tap with Google).
- **Make results the reward:** smooth animated bars, plus "You're with the 72%!".
- **Swipe through polls** (card stack) instead of a dense list. It's fast and fun on mobile.
- **Creating a poll should take under 20 seconds.** Show a live preview of the card being built.
- **Countdown chip on comments** ("disappears in 3h") so the ephemeral behaviour is understood.
- **Leaderboard visible but not loud.** A trophy icon and a "Top creators this week" strip on the feed.
- Dark mode and large tap targets.

---

## 6. Risks and how the MVP handles them

| Risk | Mitigation in MVP |
|------|-------------------|
| Empty app at launch | System polls, Poll of the Day, an admin scheduling tool |
| Novelty wears off, low retention | Daily poll, shareable links, leaderboard. Measure D1/D7 early. |
| Toxic or illegal content | Report, block, filter, admin removal, short back-end retention of expired comments |
| Leaderboard gamed with bots | Verified-account weighting, account-age threshold, spike detection |
| Polls already exist in big apps | Lean into what they lack: a dedicated fun feed, topic variety, creator fame (leaderboard) |

---

## 7. After the MVP (only if the metrics say people come back)

1. Friends and following, with notifications ("your poll hit 1,000 votes", "friend voted")
2. Image polls ("which outfit?")
3. Topics/categories and personalized feed
4. Streaks and badges
5. Native apps
6. Then think about monetization (cosmetic profile items, promoted polls for brands, ads in the feed).
