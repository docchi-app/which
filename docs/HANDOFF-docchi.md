# Handoff: app idea validations + Docchi poll app

Everything discussed in this session, for picking up in a new chat.

---

## 1. Links

| What | Link | Notes |
|------|------|-------|
| **Docchi design canvas** (all screens, style guide, logo) | https://claude.ai/artifact/QMfSt4h8MYuvNvyz912Awo | Private to the account that made it. A new account can't open it unless you **share it from the canvas's Share menu** first (or export it). |
| Rate Book (your existing app, connected to GitHub) | https://claude.ai/code/cshk_012wNoztLxhDZJLKx59Tt4uYUqpMevJq1ivyFPJfCzcttp | Your reference for how GitHub was set up there. |
| GitHub repo used this session | `itxMayank/myAssignment`, branch `claude/shared-reminder-app-validation-92zgvw` | Holds an unrelated `ParkingManagement.sln`. **Pushes failed (403)**: the Claude GitHub App has no access to this repo. |
| Install the Claude GitHub App | https://github.com/apps/claude/installations/select_target | Pick the new repo when installing. |
| Reconnect GitHub to Claude | https://claude.ai/customize/connectors?auth_start=github&auth_start_force=1 | Use if the app is installed but access still fails. |

**Files from this session (not on GitHub because the push failed; they're attached to the chat):**
- `docs/shared-reminder-app-validation.md`: full validation of the shared reminder app idea
- `docs/poll-app-validation.md`: full validation and MVP plan for the poll app
- `docs/HANDOFF-docchi.md`: this file

### Setting up GitHub for the new account (same way as Rate Book)
1. Create the new GitHub repo, e.g. `docchi` (empty, or with a README).
2. Install the Claude GitHub App on it (link above) and connect GitHub in Claude settings.
3. Start a new Claude Code session with that repo selected.
4. Copy the three markdown files into `docs/` and commit them.
5. Share the design canvas with the new account (Share menu) so it can be opened there.

---

## 2. Idea 1: Shared reminder app (validated, parked)

**Idea:** reminders assigned to several people (e.g. "take medicine, 10 pm daily" for 3 family members), auto-delete after N days, opt-out, photos, family can set reminders for elderly relatives; freemium, maybe ads.

**Verdict:** worth building, but **not** as a general shared-reminder app (crowded: Apple Reminders, Google Tasks, Todoist, Cozi, WhatsApp groups). Build it as **family care with accountability**:
- Roles: **Doer** (gets the reminder, taps Done) vs **Watcher** (only told "done" or "missed after 30 min").
- **Escalation**: remind again → alert family → optional automated phone call. This is the paid feature.
- Needs consent before someone can send you reminders, invites for people without the app, managed profiles for elders, time-zone handling, quiet hours, adherence history.
- Hardest technical problem: **reliable delivery**. Use local scheduling on the phone plus server push. Watch for iOS's 64-notification limit, Android 14 exact-alarm limits, and phone makers that kill background apps (Xiaomi, Oppo, Vivo). SMS/WhatsApp/call fallback costs money; India needs TRAI DLT registration for SMS.
- Elder UX: one big Done button, pill photo, voice note in a family member's voice, phone-call fallback.
- Money: family subscription; **no ads** (low revenue, hurts trust). B2B options: pharmacies, clinics, home nursing.
- MVP: ~8–12 weeks for 1–2 developers. Validate first with ~20 caregiver interviews and a manual WhatsApp version for ~10 families.

Full details: `docs/shared-reminder-app-validation.md`.

---

## 3. Idea 2: Docchi, the poll app (current focus)

### The idea
A light, fun social app. People create polls and others vote. The system seeds interesting polls at launch. Comments disappear automatically after a while. A leaderboard shows creators of viral polls. No monetization for now.

### Validation summary
- Easy to build (~3–5 weeks for one developer, ~$0–25/month to run). **The real risk is retention**: poll apps spike and fade (Polar, Wishbone). tbh and Gas worked because the polls were about friends.
- Decisions made:
  - **Show results only after voting.**
  - "Viral" score = unique voters in the first 48h + shares, **reset weekly**, counting only accounts older than a few hours (anti-bot).
  - Comments vanish after **24h**, with a visible countdown.
  - **One vote per person**: browse freely, sign in to vote.
- Moderation is required: report, block, profanity filter, rate limits, admin removal. **Keep reported/expired comments in the back end** so abuse can be reviewed (also expected by India's IT Rules).

### MVP scope
**In:** sign-in (Google/phone), Trending/New feed, one-tap vote with animated results, create poll (question ≤140 chars, 2–4 answers, closes after 1/3/7 days), share link with a preview image, 24h comments, weekly leaderboard, minimal profile, admin panel (schedule system polls / Poll of the Day, moderate), report/block/filter/rate limits.

**Out (later):** follows/friends, image polls, DMs, search, streaks/badges, native apps, monetization.

**Platform:** mobile-friendly web app (PWA) first; the share link is the growth engine.

**Suggested stack:** Next.js + Supabase (Postgres, auth, realtime) or Firebase; Vercel hosting.

Data model:
```
users(id, username, avatar_url, created_at, is_banned)
polls(id, creator_id, question, closes_at, is_system, vote_count, share_count, created_at)
poll_options(id, poll_id, text, vote_count)
votes(poll_id, user_id, option_id, created_at)   -- PRIMARY KEY (poll_id, user_id)
comments(id, poll_id, user_id, text, created_at, expires_at, is_hidden)
reports(id, target_type, target_id, reporter_id, reason, created_at)
```

**Success metrics (after ~4 weeks):** ≥60% of visitors vote, ≥8 votes/session, 3–5% share rate, D1 ≥30%, D7 ≥12%.

Full details: `docs/poll-app-validation.md`.

### How to get users (agreed plan)
1. Build sharing into the product: link previews with live counts, results hidden until you vote, "Challenge a friend", leaderboard needs shares.
2. Start small: 20–50 friends → one tight community (college, office, society) → public only once people return on their own.
3. Polls people can't resist: topical (cricket/IPL, movies, reality shows), light debates (biryani, pineapple pizza, WFH). **No politics/religion at launch.**
4. Turn results into social posts (Instagram/X/LinkedIn), weekly top-creator shoutout, partner with meme pages and small creators.
5. Public launch later: Reddit (r/SideProject, r/InternetIsBeautiful), Product Hunt, Show HN, Indie Hackers.
6. Tag every shared link (`?src=whatsapp`) to see which channels bring returning users.
7. No paid ads yet.

### Name
- **Chosen: Docchi** (どっち, Japanese for "which one?", said "DOH-chee"). Tagline: **"Docchi. Which one?"**
- Runners-up: **Jein** (German "yes+no"), **Golla** (Korean "pick!"), **Oder?** (German "or?/right?"), **Nu?** (Yiddish/Russian "so? well?"), **Hangisi?** (Turkish "which one?"). Also Dimmi, Boh, Bof, Bora, Sema, Chagua, Psifos, Koho (taken by a Canadian fintech), Pickle (used first, then replaced).
- **To do:** check that "Docchi" is free in the app stores, as a domain (.app/.com/.io), as social handles and as a trademark, and run it past a native Japanese speaker.

### Logo
- **Mark:** a yellow speech bubble (ink outline, hard offset shadow) with **two big eyes that glance left and right** ("this one… or that one?"), a blink now and then, and a small smile.
- **Wordmark:** `docchi?` in lowercase Bricolage Grotesque 800, tight letter-spacing, with the **?** in coral.
- **App icon:** the mark on a coral rounded-square tile.
- **Small sizes:** drop the shadow below 40px; favicon = bubble with two solid eyes.
- Idea for later: in the app, the eyes glance between answers and blink when a vote lands.

SVG of the mark (52×52 viewBox):
```svg
<svg viewBox="0 0 52 52" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 4H38A8 8 0 0 1 46 12V28A8 8 0 0 1 38 36H21L12 44V36A8 8 0 0 1 4 28V12A8 8 0 0 1 12 4Z" transform="translate(3 3)" fill="#1B1530"/>
  <path d="M12 4H38A8 8 0 0 1 46 12V28A8 8 0 0 1 38 36H21L12 44V36A8 8 0 0 1 4 28V12A8 8 0 0 1 12 4Z" fill="#FFD23F" stroke="#1B1530" stroke-width="3" stroke-linejoin="round"/>
  <circle cx="17" cy="18" r="7" fill="#FFFFFF" stroke="#1B1530" stroke-width="2.4"/>
  <circle cx="33" cy="18" r="7" fill="#FFFFFF" stroke="#1B1530" stroke-width="2.4"/>
  <circle cx="14.5" cy="18" r="3.2" fill="#1B1530"/>
  <circle cx="30.5" cy="18" r="3.2" fill="#1B1530"/>
  <path d="M21 29Q25 32 29 29" fill="none" stroke="#1B1530" stroke-width="2.4" stroke-linecap="round"/>
</svg>
```

### Look and feel: "pop poster"
Loud, friendly, a bit cheeky. Thick ink outlines, hard shadows, one bright colour per answer, every tap gets a physical response.

| Token | Hex | Use |
|-------|-----|-----|
| Ink | `#1B1530` | Text, outlines, shadows, dark buttons, nav bar |
| Cream | `#FFF7EC` | App background |
| Coral | `#FF7A59` | Primary action, answer A, create button |
| Sky | `#6CB4FF` | Answer B |
| Sun | `#FFD23F` | Answer C, highlights, active nav item, logo bubble |
| Mint | `#52D6A8` | Answer D, live/success |
| Lilac | `#B79CFF` | Profile banner, accents |
| Muted | `#5A5370` | Secondary text |
| Alert | `#B42318` | Destructive actions, expiring |

- **Fonts (Google Fonts):** Bricolage Grotesque 800 for questions, numbers, headings; DM Sans 400/500/700 for body.
- **Shape:** 2–2.5px ink outlines; hard offset shadows 3–6px, no blur; radius 14px controls, 18–24px cards, 28px hero card; 44px minimum touch targets. Text on colours is always ink (passes contrast).
- **Nav:** floating dark pill (Feed / Leaders / Profile) plus a separate coral "+" create button.

**Motion:**
| Animation | Timing |
|-----------|--------|
| Result bars grow from the left | 900ms, ease-out, staggered 80ms |
| Vote: "You're with the 46%!" pops + confetti burst | 500ms pop, 900ms burst |
| Button press: sinks, shadow flattens | 120ms |
| Cards rise in (slide up 20px + fade) | 450–550ms |
| Comment in its last hour fades in and out | slow loop |
| Sheets slide up (sign-in, share, report) | 500ms |
| Logo eyes glance left/right, blink | ~4s loop |

Everything turns off when the phone's "reduce motion" setting is on.

### Designed screens (on the canvas)
Mobile 390×844, interactive in Play mode:
1. **Feed:** logo header, Trending/New tabs, Poll of the Day card on a stack of floating cards. Tap an answer → bars grow, percentages pop, confetti, "You're with the X%!". Next/Skip cycles 4 sample polls.
2. **Sign in at first vote:** blurred feed behind, sheet slides up, "Lock in your pick", Google / phone / "Not now".
3. **Results + comments:** LIVE badge, bars with "your pick", Challenge a friend + copy link. Each comment has a ring that empties over 24h; the last-hour comment fades. Posting a comment works.
4. **Create poll:** question with counter, 2–4 answers (add/remove), closes after 1/3/7 days, live preview, Post.
5. **Leaderboard:** This week / All time, podium for the top 3 (rising blocks, wobbling crown), rows 4–7, "You #128 · Climb up" bar.
6. **Profile:** lilac banner, avatar, stat tiles (polls made, votes received, best rank), My polls / Voted tabs with mini result bars.

Desktop:
7. **Admin:** schedule system polls (Poll of the Day, topic, go-live time), upcoming list, reports queue (Remove / Dismiss / Ban). Reported comments stay even after they expire in the app.

Boards:
- **Look and feel:** palette, type, buttons and labels, six looping motion demos.
- **Name and logo:** logo on light and dark, app icon, small sizes, rules.

Sample content is illustrative (e.g. "Tea or coffee to start the day?", @pizza_judge, vote counts).

---

## 4. Next steps
1. Check "Docchi" availability (stores, domain, handles, trademark) and with a native speaker.
2. Create the new GitHub repo and connect Claude to it (section 1), then commit these docs.
3. Share the design canvas with the new account.
4. Scaffold the MVP: Next.js PWA + Supabase, using the data model, colours, fonts and motion above.
5. Build in order: feed + vote + results → sign-in → create poll → share previews → comments with expiry → leaderboard job → admin/moderation.
6. Seed ~50 system polls before the friends beta, and track the success metrics from day one.

