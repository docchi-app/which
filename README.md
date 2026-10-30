# Eithr

**Eithr? Pick a side.** (Said "ee-ther". Formerly Docchi.) A light, fun poll app: tap a side, then see where everyone else landed.
It's a mobile-first PWA built with Next.js and Supabase.

Product and design background: [`docs/HANDOFF-docchi.md`](docs/HANDOFF-docchi.md) and
[`docs/poll-app-validation.md`](docs/poll-app-validation.md). The screens are on the design canvas
linked in the handoff.

## What's built so far

The first slice of the build order:

- **Feed:** For you (trending), New and Friends tabs, Poll of the Day pinned on top, and an "All
  caught up" card at the end (with Snap one / Type a poll and Back to top). A shared link
  (`/?poll=<id>` or `/p/<id>`) puts that poll first under "Shared with you", then "More polls".
- **A feed you scroll, like X and Instagram:** cards sit in a list sized to their content, so the
  next poll is already in view; nothing scrolls inside a card. Polls you've already voted on
  follow under "Polls you've voted on". The next page loads well before the end (grey ghost cards
  if it's still coming), new cards fade in, and in a long session the oldest items above the
  screen are let go (about 60 kept) without moving what you're looking at, so the page stays light.
  On desktop: scroll, or `j`/`k` for the next / previous poll.
- **Header that gets out of the way:** scrolling down slides the logo row away and the tabs stay
  as a slim bar (with a small bell, so new activity is never missed); the first bit of scrolling
  up brings the full header back. The bottom bar dims a little while you scroll. Tapping the tab
  you're on, or Feed in the bottom bar, goes back to the top; each tab keeps its own place.
- **Pull to refresh:** at the top, pull down and let go: the list follows your finger, the eithr
  eyes spin, and fresh polls load. Newly posted polls also show a "New polls ↑" pill under the
  tabs; tapping it goes to the top with them.
- **Opens instantly:** the first 15 polls of For you are kept on the phone, so opening the app
  shows them straight away while the fresh list loads. If you've already scrolled or voted when it
  arrives, it waits behind the "New polls" pill instead of swapping under your thumb. Only shown
  to the person who saved it; wiped on sign-out or when someone else signs in.
- **One-tap voting:** results stay hidden until you vote. The tap responds instantly: your pick
  locks in and the bars fill in as soon as the server answers. The database enforces one vote per
  person.
- **Vote first, sign in later:** a new visitor votes straight away as a guest (a Supabase anonymous
  account) and sees the results, with their own pick shown in them. A guest's votes are stored but
  left out of every total and the leaderboard until they sign in with Google; linking Google keeps
  the same account, so their votes join the totals then (if that Google account already had
  Eithr, `/auth/callback` casts the guest's picks again as that account). Results show "Your vote
  counts once you sign in", and after a guest's 3rd vote a "Make your votes count" sheet asks once.
  Guests are told plainly: a one-time "Voted as a guest" note after the first vote; a closable bar
  under the logo, "🕒 3 votes not counted yet · Count them" (✕ hides it for a day); their pick reads
  "Your pick · not counted yet", the count says "(yours isn't in yet)", and a yellow strip offers
  **Count my vote**. Nothing blocks browsing or voting.
- **What we get from Google, said up front:** the sign-in sheet lists it (name for a @username,
  profile photo, email kept private) and what Eithr never does (post for you, read contacts or other
  Google data, sell your data); other sign-in buttons carry a one-line version.
  If guest sign-ins are switched off, the first tap opens the old "Lock in your pick" sheet.
- **First visit:** a "How Eithr works" sheet loops through the three moves on a small feed (tap a
  side, see where everyone lands, scroll for more), with captions, once per device. Brand-new
  visitors, guests and accounts under a day old see it; people signing in on a new phone or moving
  from the old address don't. It waits for any other sheet to close; with reduced motion it shows
  the steps as a list. An unvoted card with fewer than 10 votes says "Be the first to vote" / "Be one of
  the first to vote" instead of a tiny count, and a poll with no comments shows the bubble without
  a "0".
- **Animated results:** bars grow in from the left (900ms, 80ms apart), percentages pop,
  "🎉 You're with the X%!" appears with a confetti burst, and buttons sink when pressed. All motion
  stops when the phone's "reduce motion" setting is on.
- **Compact cards:** results fill the same rows as the answers (✓ and a "Your pick" tag on yours),
  "You're with the X%" is one line under them, and friends who voted join the footer line
  ("@priya +2 friends voted · 1,204 votes · live"), so a voted card barely grows. Comment, Share,
  views and ••• sit on one line at the bottom. A tiny buzz when your vote locks in (Android).
- **Instant screens:** Feed, Profile, Leaders, Friends and Activity remember what they last showed
  (in memory, for this visit only; cleared on sign-out). Coming back shows it straight away and
  refreshes quietly; the feed returns to exactly where you were scrolled. Profile is loaded in the
  background once the feed is in, so the first tap on it is instant too; Friends, Activity and
  Leaders are warmed the same way a moment later. A poll opened from a list shows at once, and
  `/p/…` and `/u/…` have loading screens, so every tap answers right away.
- **Optimistic actions:** comments appear as "Sending…" straight away; friend requests, who-sees-it
  and deleting a poll change on tap and undo themselves if the server says no. The next Props
  question is fetched while you look at the one you just answered.
- **Design tokens:** colours, fonts (Bricolage Grotesque and DM Sans), outlines, hard shadows and
  corner radii are CSS variables in `src/app/globals.css`.
- **PWA basics:** web app manifest, app icon, theme colour.
- **Share links:** every poll has its own link, `/p/<id>`. WhatsApp, X and other apps show a
  preview card in the poster style with the question, the answers and the vote count, never the
  result. The Share button opens a sheet with WhatsApp, X, the phone's share menu and Copy link;
  links are tagged `?src=whatsapp|x|native|copy`. Each signed-in person counts once per poll
  toward `share_count` (for the leaderboard).
- **Live numbers:** votes and views move on the cards you're looking at. One small request
  (`live_counts`) every 5 seconds asks for the counts of the cards on screen only (at most 12),
  never one request per card. New numbers count up over a few seconds instead of jumping, the bars
  glide, and "+3" pops when other people's votes land; busy polls show "🔥 41 in the last hour"
  (votes in the last hour, worked out once a minute by the views rollup). Only real numbers move.
  When nothing has changed for a minute it asks every 15 seconds; it stops while the app is in the
  background or nobody has touched it for a minute, and starts again on the next scroll or tap.
  Every 45 seconds the feed checks for newly posted polls ("New polls ↑" pill). This is polling;
  Supabase Realtime can replace it once traffic grows. Friends who voted and snap photos load only
  once a card is about a screen away, and a snap's own colour (saved in its photo's file name)
  shows while the photo loads.
- **Poll formats:** besides classic polls there are **hot takes** (a bold statement, Agree /
  Disagree, with a spice meter showing how split people are and a "Settle this" share button when
  it's close) and **mystery polls** (people see a teaser like "Pick a colour" and the answers; the
  real question stays on the server until they vote, then it's revealed). Anyone can post one of
  these a day. Eithr's own polls show a **verified** tick, in the app and on link previews.
- **The phone's back button:** on the feed, from New or Friends it goes back to For you (only
  then out of the app). It closes whatever is on top (comments, share, report, sign-in,
  install and delete sheets, the + menu, ••• menus, "How Eithr works") instead of leaving the
  screen; on a snap it goes from the question back to the camera. Each open layer adds a history
  step for the same page (`src/lib/back.ts`), and closing it with its own button removes that step,
  so back never needs an extra press. ✕ and ← on Create, Snap and Settings go back to where you
  came from, and posting replaces the create screen, so back from a new poll doesn't reopen the
  empty form.
- **The + button:** two big choices pop up right above it, **📸 Snap it** and **✍️ Type it**; one
  tap opens that screen. Tap + again (now ✕), outside, or Escape to close.
- **Create poll (Type it, `/create`):** the keyboard opens on the question (up to 140 characters),
  then 2 to 4 answers (up to 40 each); Enter moves to the next box and never posts. Picking
  Mystery takes you to its teaser box. On Android the keyboard shrinks the page
  (`interactive-widget=resizes-content`), so Post and Send stay above it. Everything else is on the same screen, no "More options":
  **Who sees it** (Everyone / Friends / Link only; Friends can pick lists), **Style** (Classic / Hot
  take / Mystery) and how long it's open (1, 3 or 7 days). The live preview is off; admins can turn
  it on for their phone in **Settings → Live preview**. Anyone signed in
  can post up to 10 polls a day (counted from midnight India time; the number is set in **Admin →
  Run → Limits**, and the admin isn't limited). The first poll also picks a username: a free one is prefilled
  from the Google name, it's checked as you type, and a taken name comes with free suggestions to
  tap. Unfinished drafts survive a reload or a trip through sign-in. After posting you land on your
  poll and the share sheet opens by itself ("Your poll is live 🎉 Drop it in the group chat"); the
  "Your poll is live!" banner stays on the card after it's closed. Share cards with fewer than 10
  votes say "Be the first to vote" / "Be one of the first" instead of a tiny count.
- **Profile:** a short lilac banner with the avatar (Google photo or initial) overlapping it and
  Edit beside it (live availability check and suggestions; once a week); the full @username on its
  own line, then the joined date and a **🏆 Best rank #N** badge for anyone who has made the weekly
  top 100 creators (on public profiles too; taps through to Leaders); the stats as one slim strip
  (Polls, Votes got, Friends, 🔥 Streak); and **My polls / Voted** tabs (with a "✨ +N votes" chip
  for news). Poll rows are compact: question, mini bar, then tags (Live/Ended, Link only,
  Friends…) and numbers on one line. Your own polls have a share button and a **•••** menu: Share,
  Who sees it (Everyone / Friends / Link only) and Delete (with a confirm).
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
- **Views:** how many people saw a poll, in the card's action row (X-style): ✨ **New** under 5,
  👀 **Noticed** under 10 (tap for "People are noticing"), then the count (3.4K, 12K, 1.2M). Your own
  polls always show the exact number, here and on your profile rows ("61 views · 12 votes"). A view
  is one person seeing the card (half on screen for a second, or most of the screen for a card
  taller than it, or voting); each person counts once
  per poll, the creator never does, and views never show below votes. The action row never grows:
  if it would overflow, it gives up the least first (Share's word, then "Noticed",
  then spacing), checked by `npm run check:layout`.
  *How it scales:* the phone remembers what it already counted and sends new views in batches (2
  seconds after the first, then at most every 10 seconds, and on leaving), signed in straight to
  `record_views()`, signed out through `/api/views` (a hash of connection + browser + secret, bots
  skipped). Batches land in an unlogged, index-free `view_buffer`; `views_rollup()` (pg_cron,
  every 10 seconds; one setting to slow down later) dedupes into `poll_viewers` and updates each
  poll's total once per run. Who viewed a poll is deleted a day after it closes; the total stays.
- **Friends voted:** on a public or link poll, "(faces) @priya +2 voted" sits under the creator's
  name before you vote, and moves into the footer line once you have. Never what they picked
  (`friends_voted()`), and only friends you've both accepted. On a short screen where the line
  would make the card scroll, it stays hidden until you vote.
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
  poll, on Eithr's polls, from guests who haven't signed in, from banned accounts or from accounts
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
- **Admin (`/admin`):** only for the one admin account (`profiles.is_admin`; the database allows
  exactly one). Everyone else, signed in or not, gets the normal "page not found", decided on the
  server before anything is sent. On a laptop the sections sit in a sidebar (Today: Overview ·
  Health: Errors · People: Users, Guests · Growth: Funnel & retention, Sources, Metrics · Content:
  What people like, Polls & snaps, Notifications · Safety: Reports, Snaps, Words · Run: Schedule, Limits, Test accounts, Admin
  log) with **← Back to Eithr** at the top; on a phone they're tabs, with ‹ back. The section is in
  the address (`/admin#metrics`). **Overview** is what `/admin` opens: what needs you (a new error,
  reports waiting, no sign-ups for a day, the background job stopped), each with a button to fix it;
  today against yesterday and the same day last week; four goals; and visitors and voters for 14
  days. The goals are fixed launch targets (60% of visitors vote, 30% back the next day, 2 shares
  per poll, 50% of people with notifications on), drawn as the marker on each bar; changing them is
  a code change (`GOALS` in `src/components/AdminGrowth.tsx`). **Funnel & retention:** daily,
  weekly and monthly active, where first visits drop off (visited → voted → signed in → made a poll
  → shared → added a friend, each within 7 days), come back after 1 / 7 / 30 days by the week people
  joined, and back-next-day compared (notifications on or off, invited or found it, signed in or
  guest). **Sources:** where first visits came from, who brings people in, which polls brought the
  most, and each phone and browser's vote, sign-in and error rate. **What people like:** every poll
  is tagged with a topic (cricket, food, movies, …), a feel (debate, relatable, emotional, nostalgia,
  …), timely or evergreen, and its language (English, Hinglish, Hindi), by the AI in the 2-minute job
  or by you. Each poll seen by 5 or more people gets a **Spark** score out of 100 (voted ÷ saw 40,
  shares 25, comments 20, how close the result was 15). The screen adds it up by topic, feel, topic +
  feel (a grid: dashes are combinations not tried yet), language, time of day, timely or evergreen,
  and who posted (Eithr, you, people), with the best polls and the newest polls' tags to check and
  change. Fewer than 5 polls behind a number is marked Early, 5 or more Clear. **Polls & snaps:** polls made by
  kind per day, votes per poll, polls with no votes, comments, the top polls, snaps (live, sent to
  you, turned down), safety checks (AI, blocked words, reports) and props by question.
  **Notifications:** pushes sent and tapped by kind, expired and failed, emails (lunch, evening,
  clicked), who turned notifications off, who allows them by phone, and the 2-minute job. Settings
  has **Morning summary at 9 am** for the admin (off at first): a push with yesterday's visitors,
  sign-ups, votes and anything waiting. **Reports** lists what's waiting
  (auto-hidden polls first) with the full poll, who posted it and their report history:
  Remove poll, Keep / Dismiss, or Ban (they can't vote, post or report, and all their polls are
  hidden). Reports filed by the AI check show as "🤖 Auto check: harassment" (and the like).
  **Words** is the word filter's list: test any text ("Blocked by: bsdk"), add a word (whole word,
  start of a word, anywhere, or always allow) or remove one. **Schedule** shows Poll of the Day for the next three weeks, flags empty days, and adds, edits
  or removes one (classic, hot take or mystery; open 1–7 days; goes live at midnight India time).
  **Test accounts** are left out of Metrics, together with your own account: their votes, polls,
  shares, sign-ups, and visits from any phone they've signed in on. **Admin log** lists
  moderation actions with Undo, and other changes (words, test accounts, settings). **Metrics** shows visitors, votes, % of
  visitors who vote, votes per session, votes per 100 views, share rate and D1/D7 retention
  against the launch targets, plus a table by day. **Errors** (setup step 9) shows what broke and
  for whom: new errors, people hit, and whether the background jobs ran; one line per kind of
  error (repeats grouped) with people, times, last seen and New / Open / Back after fix / Fixed /
  Ignored; open one for its hour-by-hour chart, phones and browsers, who (signed in, guests,
  visitors), the latest times with their stack, **Copy for Claude** (a ready-to-paste report,
  counts only), **Open GitHub issue** (the same text in a new issue) and Mark as Open / Fixed /
  Ignore. `/admin#errors/12` opens one directly.
  **Users** (setup step 10) lists everyone who signed up: tiles for signed up (+ this week),
  active this week, notifications on and joined-but-never-voted (test accounts and you left out);
  search by username or name; filters (joined this week, no vote yet, notifications off, banned,
  test); sort (newest, last active, most votes, most friends); each row shows how they joined
  (Google, or was a guest first and for how long), where their first visit came from (a shared
  poll and whose, an invite, Instagram, WhatsApp, email, the old address, a search or another
  site, or Unknown for visits before this was recorded), phone, last active, votes, polls,
  friends and notifications (On, Off, Never asked, Blocked). Export CSV waits for the
  authenticator code. Click someone (or `/admin#users/<id>`) for their page: email hidden until
  **Show** (logged), facts, 8 counts, a timeline of what they've done, every poll they made with
  Remove / Restore, and Mark as test account, Reset username (they pick a new one), Copy user ID
  and Ban (type their username to confirm) / Unban. **Guests** shows visitors → guests who voted
  → guests who signed up, how long that took, the guest share of votes, how many left after one
  vote, and the guests themselves by a short code (never a name).
- **Something went wrong:** a screen that fails to draw shows "Something went wrong" with **Try
  again** and **Go to the feed** instead of a blank page, and the error goes to Admin → Errors.
- **Tips, one at a time:** a small dark bubble beside the thing it explains, shown once, at the
  moment it's useful: + after your 2nd vote, 💬 when you vote on a poll that has comments (on that
  poll's card), Leaders
  after your first poll (or 6 votes), the Friends tab after 8 votes, the bell when your polls have
  news. Never more than one every 2 minutes, never while a sheet is open, never blocks a tap; any
  tap, scroll or 7 seconds hides it (`src/lib/tips.ts`, `TipLayer`).
- **What's new on your polls:** a dot on the bell when your polls got votes or comments since you
  last looked (friend requests show a number on the bell and the Friends tab until you've seen
  them; they stay listed until you answer). Opening Activity clears the dot straight away, and the
  bell checks again whenever you come back to the app. Activity and
  Profile → My polls show a
  "Since your last visit: +14 votes · 3 comments" line and a chip on each poll with news. It's
  marked seen after a moment on screen (`my_activity()` / `mark_activity_seen()`, stored per account).
- **Settings (⚙︎ on Profile):** notifications, the app (Home Screen), account (Admin, Sign out,
  Delete account) and the policies, so Profile stays about your polls.
- **Delete account (Settings):** says what goes, asks you to type DELETE, then deletes for good
  and right away: profile, polls and snaps (with their votes and comments), your votes and
  comments elsewhere (they leave other polls' totals), friends, lists, notifications and the
  sign-in itself. Snap photos are removed from Storage first; the database refuses to delete
  while any are left, so none are orphaned. Signing in with Google again starts a new account.
- **Offline:** the service worker keeps the app's files and the pages you've opened, so Eithr
  opens without a connection: the feed says "You're offline" and loads by itself when the
  connection is back, a "📡 You're offline" bar shows on every screen, and pages you haven't
  opened show `/offline`. Pages always come from the network first, so nobody gets a stale app.
- **Quick snap (+ → Snap it, "Snap one" on the caught-up card, or `/snap`):**
  Shoot → Ask → Send. The camera opens straight away in a 3:4 frame that is exactly the feed card:
  tap to focus there (a ring, with a ☀ beside it: drag up or down for brightness), pinch or tap
  .5 / 1× / 2× to zoom, and up top flash, a 3 or 10 second timer (tap the shutter again to cancel)
  and a grid. Phones differ in what they let a website control, so: real focus, zoom and exposure
  where the camera offers them (most Android phones), otherwise zoom crops and brightness is applied
  to the photo (iPhone: autofocus only, 1× / 2×); flash is the torch on the back camera where there
  is one, and the screen lights up white for the front camera. The camera turns off while the app
  is in the background and back on when you return. Camera shots get the 📸 Live badge. A gallery photo
  that's upright goes straight through; any other photo gets a **Frame your photo** step (drag
  and pinch to fill the card, or **Show whole photo** on a blurred fill). Then one page finishes
  it, scrolling like the feed with **Send** pinned at the bottom: the photo on its own (half the
  screen at most, with ↺ Retake and **👁 How friends see it**, which shows the card as it will look
  in the feed), then **Your question** and **Answers** (the last idea is filled in, so Send works
  straight away), the ideas, and **Who sees it**. Scroll past the photo and it shows small in the
  top bar. Nothing is focused when the page opens (iPhone only opens the keyboard for a tap); while
  the keyboard is up only the question and answers show, and putting it away (Done, ‹, or the
  phone's own back/hide key: the page notices) brings the rest back. Ideas (Buy or skip? / Rate my
  fit / Should I go? / This or that? / Rate my food / Too much?) wrap, no sideways scrolling.
  Typing your own question, or clearing it, removes the idea's answers: only **+ Add answer** is
  left, with pairs to fill in with one tap (the two sides of an "X or Y?" question, or Yes / No),
  and Send says what's missing ("Add 2 answers"). Picking an idea brings its answers back. 2–4
  answers (× to remove); long ones get a row each. **Who sees it** is a row per choice, and Send
  says where it's going ("Send to friends →"):
  👥 Friends (they see who picked what; greyed out with "Add friends first" until you have one),
  🌍 Everyone (counts only; "From tomorrow" for accounts under a day old) or 🔗 Link only (in nobody's feed: after Send, "Send it to someone" opens with
  WhatsApp first; whoever opens the link can see it and vote). The last idea and audience are
  remembered. Every photo is made
  exactly 3:4 at 1080 × 1440 on the phone (WebP, about 150–400 KB, location data removed), so
  upright photos fill the card with nothing cut off. In the feed a snap is a normal Eithr card
  with the photo filling its top edge to edge (nothing on it but who posted it) and the question
  and answers below it, where the answers fill with the results. On your own snap, **•••** →
  Share, **Who sees it** (Everyone / Friends / Link only, say it went to Everyone by mistake;
  it leaves the public feed at once and votes stay; a snap can't go public after it's sent,
  because public snaps get a stricter photo check) or **Delete snap** (gone for everyone, and
  its photo is removed straight away). Your own typed polls in the feed have the same **•••**
  → Who sees it. It disappears after 24 hours.
  Photos go to the private `snaps` bucket and the snap stays hidden until `/api/snap/check`
  passes the photo and its words through OpenAI's free moderation: clean → live (and the share
  sheet opens), unsure → **Admin → Snaps** for you to approve or reject (turned down after 12
  hours), clearly bad → rejected. Everyone snaps get a stricter bar (and a snap can't be
  switched to Everyone afterwards); accounts under a day old can send to Friends or Link only; 3 snaps a day (Admin → Limits), counted from midnight
  India time (deleting one doesn't give it back; the admin isn't limited). Snaps stay off
  profiles, and their photos are deleted once they close (by the owner's app, or Admin → Snaps →
  Clean up).
- **Props (💜 compliment polls about your friends):** a purple "About your friends" card shows up
  a few polls into **For you** (and all of today's questions are at `/props`, from the Friends tab):
  a question Eithr wrote ("Who has the best laugh?") with 4 of your friends as answers. Pick one,
  **Shuffle** (twice per question) or **Skip**. It's anonymous: the friend gets a push and an
  Activity item ("💜 You got props for Best laugh"), delayed a random 5–30 minutes and grouped so
  the timing doesn't give you away, and nobody ever sees who picked them. 10 questions a day
  (India time), the same question not again for 7 days, never the same friend twice for one
  question. Needs 4 friends who can be picked; before that, an "Unlock Props" card (once a day)
  invites more. Profile shows **What friends say about you** (counts only, only you see it), and
  each one can be shared as a story picture drawn on the phone. Settings → **Include me in
  Props** (on by default) and a "Friends gave me props" notification switch. 100 questions, all
  compliments, in `prop_questions`.
- **Streaks:** 🔥 N next to the bell: days in a row (India time) you've voted on at least one poll.
  It's grey until you vote today (the streak lives until midnight); tap it for your best. Hitting
  3, 7, 14, 30… days pops a "🔥 7-day streak!" bubble. Guests' votes count, so signing in keeps it
  (`my_streak()` / `streak_of()`, from the votes table).
- **Results are in:** Activity lists polls you voted on or made that closed in the last 3 days:
  the winning answer and its share, and "You called it 🎯" or what you picked (`recent_results()`).
- **Phone notifications (web push):** a slim "Get notified → Turn on" row on Profile, and "Get a ping
  when votes come in" on a poll you just posted, while they're off on that phone (✕ hides it for a
  month); once on, it disappears. Settings → Notifications has a
  switch for each kind: **votes** on your polls (at 3, 5, 10, 25, 50, 100…), **friends** (friend requests, new friends,
  friends-only polls), **results** (when a poll you voted on or made closes) and **Eithr's polls**: the Poll of
  the Day at 9am (an invitation with "Keep your 🔥 5-day streak going" when you're on one, or, if
  you already voted, "Chai leads with 62% so far"), "New on Eithr 🗳️" when any other Eithr poll
  goes live, and an 8pm "Your 🔥 6-day streak ends at midnight" for streaks of 3+ days not yet kept
  today.
  Quiet 11pm–8am India time (what comes in at night goes out at 8am), no daily cap, and tapping
  one opens the poll. Works on Android and
  desktop browsers; on iPhone, only after adding Eithr to the Home Screen (iOS 16.4+), and the
  app says so. Signing out stops that phone getting your notifications.
- **Get the app (Home Screen):** a step-by-step sheet. On iPhone: Share → Add to Home Screen →
  Add, with an arrow pointing at Safari's Share button (or at the top for Chrome on iPhone),
  opened from Profile's notifications row (How?) or Settings. Inside Instagram, Facebook, WhatsApp and
  other in-app browsers: how to open Eithr in Safari or Chrome, plus Copy link. On Android: a
  real **Install Eithr** button when Chrome offers it (Settings → The app), otherwise ⋮ →
  Install app. After someone's 3rd vote in a browser it offers itself once; "Not now" waits a
  week. iPhone can't show an install prompt like Android: Apple doesn't allow it for websites.
- **Asking people back in (`lib/asks.ts`):** at the moments worth hearing about again (you
  posted a poll, got props, added or accepted a friend) Eithr asks for whichever step is
  missing: on iPhone in Safari or inside Instagram/WhatsApp, the Home Screen sheet with a reason
  that fits ("Want to know the moment friends vote?"); where notifications can work, a
  **Turn on notifications** sheet whose button asks the phone straight from the tap (the only way
  iPhone shows its "Allow" box). Each at most once a week, never after "Don't Allow" or turning
  them off in Settings (right after posting, the poll's own "Get a ping" row asks instead). The
  **first time Eithr is opened from the Home Screen** (iPhone or Android) it asks full screen,
  once, with what notifications bring: votes on your polls, props (never who), friend requests,
  the Poll of the Day. People push can't reach get emails instead (setup step 8).
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

### Migration check

`supabase/checks/migration-check.sql` lists every migration that hasn't fully run on a database
(a missing function or column, an older version of a function, or a function it closed to
signed-out visitors that they can run again). Paste it into the Supabase SQL
editor; no rows means everything is in place. It's generated from `supabase/migrations/`, so
regenerate it after adding a migration:

```bash
npm i --no-save @electric-sql/pglite    # once
node scripts/migration-check/make.mjs
```

### Layout check

`npm run check:layout` catches text that runs out of its box: it opens every poll format filled
with the longest content allowed (140-character questions, 60-character answers, single 60-letter
words, 24-character snap answers, 20-character usernames, 999K views with 99 comments), before
and after voting, at 320, 360, 390 and 412px wide, plus every main screen and sheet, and fails if
any text spills out, gets cut off, makes the page scroll sideways, or if a card's action row
wraps, grows or has anything past its edge. It also opens an everyday voted mystery poll on
full-size phones (390×844, 411×851, 412×892) and fails if the card scrolls inside itself or if ✓
ends up alone on its line; scrolls the feed at every width and fails if the slim bar (tabs + bell)
wraps, spills or sits off the top, or if any card in the list scrolls inside itself; and opens the
first-visit "How Eithr works" sheet at every width, with and without motion, failing if it scrolls
or any caption spills. It runs against a pretend Supabase (`scripts/layout-check/`),
so no real data is touched. Run it before shipping UI changes:

```bash
npm i -D playwright && npx playwright install chromium    # once
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54339 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon npm run build
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54339 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon npx next start -p 3145
npm run check:layout                                         # in another terminal
```

Failures come with screenshots in `scripts/layout-check/out/`.

### Brand and videos

Name, pronunciation ("ee-ther"), logo, colours and taglines: [`docs/brand.md`](docs/brand.md).
Promo videos with a voice-over that says the name right: [`scripts/video-kit/`](scripts/video-kit/README.md).
Moving people from the old address (dochhi.vercel.app) to eithr.app, signed in, in one tap:
[`docs/moving-to-eithr.md`](docs/moving-to-eithr.md) (the one-time notification and the redirect).

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
   `20261110000000_activity.sql`, `20261111000000_guest_votes.sql`, `20261112000000_friends.sql`,
   `20261113000000_streaks.sql`, `20261114000000_quick_snap.sql`,
   `20261115000000_snap_photo_size.sql`, `20261116000000_snap_answers.sql`,
   `20261117000000_delete_account_best_rank.sql`, `20261118000000_props.sql`,
   `20261119000000_security_hardening.sql`, `20261120000000_friends_voted_early.sql`,
   `20261121000000_notification_fixes.sql`, `20261122000000_views.sql`,
   `20261123000000_docchi_poll_pushes.sql`, `20261124000000_rename_eithr.sql`,
   `20261125000000_push_repair.sql`, `20261126000000_live_feed.sql`,
   `20261127000000_link_snaps.sql`, `20261128000000_moderation.sql`, …),
   in date order,
   each one once.
   Then paste `supabase/checks/migration-check.sql` and run it: no rows means every migration is
   in place; otherwise each row names one that was skipped (run that file, then check again).
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
  "New polls" pill stay alive;
- 20 evergreen polls, live now and open for 30 days.

It also keeps the original `seed.sql` polls open for 30 more days. It's safe to re-run, and dates
count from the day you run it. To write your own, copy a row in the `pack` list.

### 3. Google sign-in

**In Google Cloud** ([console.cloud.google.com](https://console.cloud.google.com)):

1. Create a project (for example "Eithr"), or pick an existing one.
2. **APIs & Services → OAuth consent screen** (called **Google Auth Platform** in newer
   consoles): user type **External**, app name **Eithr**, your support email, and the
   `openid`, `email` and `profile` scopes. While it's in **Testing**, only the test users you add
   can sign in. Click **Publish app** when you're ready for everyone.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type
   **Web application**:
   - **Authorized JavaScript origins:** `https://eithr.app` (and `http://localhost:3000`
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
   - **Site URL:** `https://eithr.app`
   - **Redirect URLs:** add `https://eithr.app/auth/callback`,
     `https://*.vercel.app/auth/callback` (preview deployments) and
     `http://localhost:3000/auth/callback`
4. On the same page, turn **on** **Allow anonymous sign-ins**. Visitors vote as guests before
   signing in; their votes only count once they link Google (step 2). With it off, the app asks
   for Google at the first vote instead.

**Show "Eithr", not the Supabase address, on Google's screen.** By default Google sends people
back to Supabase, so its screen says "Sign in to <project-ref>.supabase.co". To run sign-in
through this site instead:

1. On the same OAuth client in Google Cloud, add the redirect URI
   `https://eithr.app/auth/google/callback` (keep the Supabase one too; guest
   linking still uses it). Add `http://localhost:3000/auth/google/callback` for local development.
2. In Vercel, add `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (the Client ID; it's public) and
   `GOOGLE_CLIENT_SECRET` (the Client secret; server-only, mark it **Sensitive**). Redeploy.
3. In Google Auth Platform → **Branding**, fill in the app name, logo, home page, privacy and terms
   links. Google shows "Sign in to eithr.app" straight away, and the app name **Eithr**
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

**Make yourself the admin** (once, in the SQL Editor), then open `/admin` (also in
Settings → Account). There can only be one; to hand it over, take it off first:

```sql
update public.profiles set is_admin = true where username = 'your_username';
-- later, to change who it is:
-- update public.profiles set is_admin = false where is_admin;
-- update public.profiles set is_admin = true where username = 'new_username';
```

### 5. Deploy (Vercel)

Import the repo on [vercel.com](https://vercel.com), add the same two environment variables (plus,
optionally, `NEXT_PUBLIC_SITE_URL=https://eithr.app` so link previews always use that
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
   select public.schedule_push('https://eithr.app', '<PUSH_CRON_SECRET>');
   ```

   Every 2 minutes pg_cron calls `/api/push/run`, which collects new events into
   `notifications` and sends them. To check it's running:
   `select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;`
   and `select status_code, content from net._http_response order by created desc limit 5;`
   (expect `200` and something like `{"sent":0,"gone":0,"failed":0}`). A `500` with
   `collect_failed` carries the database error in `detail`; usually a skipped migration, which
   `supabase/checks/migration-check.sql` finds. If a scan step fails, notifications already
   waiting still go out, and the error is kept:
   `select * from public.push_errors order by at desc limit 5;`

**If "Send me a test" fails,** the card says why:

- *the secret doesn't match*: run `schedule_push` again with exactly the `PUSH_CRON_SECRET` value
  from Vercel (stray spaces are ignored).
- *the push service refused it*: `VAPID_PRIVATE_KEY` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` aren't
  the same pair. Fix them in Vercel and redeploy; people may need to turn notifications off and on.
- Vercel → your project → **Logs** shows `push test:` / `push run:` / `push send failed:` lines
  with details.

The card on Profile only appears once `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is set. Losing the private key
means everyone has to turn notifications on again, so keep a copy.

### 7. Quick snap (photo polls)

1. Run `20261114000000_quick_snap.sql` (it creates the private `snaps` Storage bucket and its
   access rules), then `20261115000000_snap_photo_size.sql` (raises the bucket's limit to 600 KB
   a photo for the sharper 1080 × 1440 snaps) and `20261116000000_snap_answers.sql` (snaps with
   your own answers). Without these, sending a snap says "Snaps aren't set up yet".
   `20261127000000_link_snaps.sql` adds Link only snaps (without it, sending one says "Couldn't
   post your snap"). `20261128000000_moderation.sql` brings the stronger word filter, Admin → Words
   and the AI check on typed polls and comments.
2. Create an API key at https://platform.openai.com/api-keys (the moderation check it's used for is
   free) and add it in Vercel as `OPENAI_API_KEY`, marked **Sensitive**. Redeploy.
3. Snaps record their check result with `PUSH_CRON_SECRET` (the same value as for notifications,
   step 6), so that has to be set too.

Without `OPENAI_API_KEY` every snap waits for you in **Admin → Snaps**; without `PUSH_CRON_SECRET`
the check can't record its result, and snaps show there as "check didn't run". Either way nothing
goes live unchecked.

The same key and secret run the AI check on typed polls and comments. Those go live at once and
are checked a second later; without the key (or before the moderation migration) only the word
filter applies. Posts the app didn't send are picked up by the notifications job every 2 minutes.

### 8. Email (for people without notifications)

On iPhone, notifications only work once Eithr is on the Home Screen, so many people never get
them. Anyone with no phone set up for push gets up to two short emails a day from the
notifications job: at **lunch** (12:30–2 pm India time) and in the **evening** (6:30–9 pm). Each
covers only what came in since the previous email (votes or comments on their polls, props,
friend requests, a poll that closed), so nothing repeats; with nothing new, no email. It goes out
whether or not they've opened Eithr that day. The subject leads with the strongest thing (props,
then friend requests, then votes, then comments). Votes emails say how the race looks without
saying which answer leads: the poll closed, a milestone (10, 25, 50, 100 votes), the first vote,
a tie, neck and neck, or one answer pulling ahead, with the answers shown as "???". Each line
has a few wordings, picked per person per day.
Every email has a one-click **Stop these emails** link (signed per person); Settings → **Email me
what I missed** turns it off or on. Props never say who.

To check it without waiting for a window, the admin has Settings → Email → **Send me a test email**:
pick a version (props, friend requests, comments or any of the votes ones) and it sends a sample,
marked [Test], to the admin's own address straight away. Up to 10 a day; each shows in Admin → Admin
log. Needs `20261204000000_email_test.sql`.

1. Run `20261201000000_email_summary.sql`, `20261202000000_email_twice.sql` and
   `20261203000000_snap_day_limit.sql` and `20261204000000_email_test.sql` in the SQL Editor
   (then the migration check).
2. Sign up at https://resend.com (free: 3,000 emails a month, 100 a day). **Domains → Add
   Domain** → `eithr.app`, and add the DNS records it shows where your domain is managed (wait
   for "Verified").
3. **API Keys → Create** (permission: Sending access) and add it in Vercel as `RESEND_API_KEY`,
   marked **Sensitive**. Optionally set `EMAIL_FROM` (default `Eithr <hello@eithr.app>`; the
   address must be on the verified domain). Redeploy.

Without `RESEND_API_KEY` nothing is sent and nothing else changes. Sends are recorded in
`email_sends` (one per person per send: lunch and evening; a send that fails isn't retried in
that window). Resend's free plan allows 100 emails a day, about 50 people at two a day; past that,
move to its paid plan.

### 9. Errors (Admin → Errors)

Run `20261205000000_errors.sql` in the SQL Editor (then the migration check). From then on:

- **The app** reports its own errors: a screen that fails to draw, script errors, unhandled
  promise errors, and requests to the database or our API that fail or get a server error.
  Ignored: being offline, leaving the page, cancelled requests, browser-extension noise.
- **The server routes** (snap check, AI text check, views, test notification) and **the 2-minute
  job** (push, email, AI sweep) report theirs with `PUSH_CRON_SECRET`; the database job's own
  errors (`push_errors`) come in by themselves.
- Recorded: the error, the screen, the first lines of the stack, phone and browser type, app
  version (`NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`, set by Vercel), and whether the person was signed
  in, a guest or a visitor. Never anything typed, photos or IP addresses. At most 20 reports an
  hour per person or browser; kept 30 days.
- **Alerts:** the job pushes your phone for a new error hitting 3+ people, a spike (10+ in an hour
  and 5× its usual rate) or one back after you marked it fixed. At most one an hour, never for an
  ignored error, and between 11 pm and 8 am India time only if 25+ people were hit. Your phone
  needs notifications on.
- **GitHub issues** go to `docchi-app/which`; set `NEXT_PUBLIC_GITHUB_REPO` (owner/name) to change it.

### 10. Users and guests (Admin → People)

Run `20261206000000_people.sql` in the SQL Editor (then the migration check). From the next visit
each browser tells us, once, where its first visit came from, and whenever they change, its phone
and browser type, whether Eithr is installed, and its notifications answer (`visitor_info`; never
the full address, the exact model or an IP address). Browsers seen before this went in show
"Unknown" for where they came from. Guests who link Google get `profiles.was_guest` and
`signed_up_at` from now on; older accounts count as joining when they were made.

### 11. Overview and growth (Admin → Overview, Growth, Content)

Run `20261207000000_growth.sql` in the SQL Editor (then the migration check). Overview, Funnel,
Sources and Polls & snaps work at once from what's already recorded. From then on the app also
counts: a tapped notification (each push link carries its id, `?n=…`; only its owner can mark it),
an opened email link, notifications turned off in Settings, and posts the word filter stopped (where,
never the words). The 2-minute job adds a daily count of pushes sent, expired and failed (expired
and failed are per day, not per kind). Kept 90 days (the daily job counts a year). To get the 9 am
summary, turn on Settings → **Morning summary at 9 am** (it needs notifications on that phone).

### 12. Daily limits (Admin → Run → Limits)

Run `20261208000000_limits.sql` in the SQL Editor (then the migration check). Polls go from 5 to
10 a day and snaps stay at 3, both counted from midnight India time; hot takes and mystery polls
stay at 1 a day inside the polls limit. Change either number in **Admin → Run → Limits** (polls 1–50,
snaps 1–20): it works at once, and each change goes in the Admin log. The admin isn't limited.

### 13. Lockdown

Run `20261209000000_lockdown.sql` in the SQL Editor, then the migration check (no rows). Nothing
changes for anyone using the app: it only stops signed-out callers (the public anon key, no
sign-in) from running the 53 database functions that need a signed-in person anyway. If the
check later names this migration again (after re-running an older migration, say), run it again.

### 14. What people like (Admin → Content)

Run `20261210000000_likes.sql` in the SQL Editor (then the migration check). With `OPENAI_API_KEY`
already in Vercel (step 7), the 2-minute job starts tagging polls at once: new ones first, then
older ones, about 600 an hour. Only the poll's question, teaser and answers go to OpenAI (never
who posted it); the answer can only be one of the listed tags. It uses `gpt-4.1-mini` (a fraction
of a cent per poll); to use another model, add `OPENAI_TAG_MODEL` in Vercel. Change a wrong tag in
**Admin → Content → What people like → Check the tags**; the AI won't change it back.

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
| Word filter | `blocked_matches()` / `has_blocked_term()`, used by polls, snaps, comments, usernames and friend lists. The text is cleaned first (`mod_clean()`: lower case, accents and Devanagari nukta out, leetspeak like sh1t / a$$, symbols inside words, spaced-out and stretched letters), then matched against `blocked_terms` (~250: English, Hinglish, Hindi and Marathi in both scripts, mc/bc/bsdk…) as a whole word, the start of a word, or anywhere; 'allow' words are never blocked. Managed in Admin → Words |
| AI check on typed polls and comments | Live at once, then `/api/moderate/check` runs OpenAI's free moderation on the author's own unchecked posts (`my_unchecked_texts()`); the push job sweeps anything missed (`texts_to_check()`). `set_text_verdict()` (needs `PUSH_CRON_SECRET`): clearly bad (or strong violence aimed at someone: violence ≥ 0.7 with a threat ≥ 0.2 or violent wrongdoing ≥ 0.3) → hidden like 3 reports and in the Admin queue; unsure → in the queue |
| Counters stay correct | `cast_vote()` saves the vote and bumps both counters in one transaction |
| Results hidden until you vote | Clients can't read `poll_options.vote_count` directly. `get_feed()` only returns counts once you've voted or the poll has closed |
| No direct writes from the browser | Inserts and updates are revoked for `anon` and `authenticated`. Writes go through database functions |
| Banned users and closed polls | Checked inside `cast_vote()` |
| Comments disappear after 24h | `expires_at`, filtered in `get_comments()`. Rows stay in the database so moderators can review them (the purge removes them after 180 days) |
| Rate limits (app requests only; the SQL Editor isn't limited) | Triggers: votes 120 per 10 min and 1,500 a day; circle requests 20 per 10 min (and 50 a day); shares 60 an hour; blocks 30 an hour; groups 20 an hour; group members 300 an hour. Polls, comments, reports and usernames have their own limits. Over a limit → `docchi:slow_down` |
| Comments only for people who voted (or a closed poll, or its creator), and circle polls stay in the circle | `can_read_comments()` in `get_comments()` / `post_comment()`; the comments table isn't readable by clients |
| Reports: signed-in only, 20 a day, one per person per poll; 3 reporters hide a poll | `report()` |
| Only the admin sees reports and metrics, or removes / bans | One admin at most (`profiles_one_admin` unique index); `require_admin()` in every `admin_…()` function; `/admin` answers 404 on the server to anyone else; `reports`, `visits`, `mod_actions`, `admin_events` aren't readable by clients |
| Only the admin sees people's details | `visitor_info` isn't readable by clients; `admin_users()`, `admin_user_detail()`, `admin_guests()`… need `require_admin()`; emails only through `admin_user_email()`, which writes the admin log |
| Error reports can't be read or flooded | `app_errors`, `app_error_events`, `job_status` aren't readable by clients; `report_error()` keeps 20 an hour per person or browser (2,000 in 10 minutes in all) and cuts long values; server and job reports and `errors_tick()` need `PUSH_CRON_SECRET`; `admin_error…()` need `require_admin()` |
| Banned accounts can't vote, post or report, and their polls are hidden | `admin_act('ban')`, checked by `cast_vote()`, `create_poll()`, `report()` |
| Push goes only to your own devices, only for things you can see | `save_push_subscription()` ties a phone to the signed-in account; `push_scan()` uses `can_view_poll()` for circle polls; subscriptions and the outbox aren't readable by clients |
| Only the app's sender can collect and send pushes | `push_collect()`, `push_gone()`, `push_test_targets()` need the `PUSH_CRON_SECRET` (stored hashed in `push_config`) |
| Data is deleted on schedule (as the Privacy page says) | `purge_old_records()` daily via pg_cron: removed polls, old comments and resolved reports after 180 days, visits after 2 years |

**The feed** (`get_feed`) shows open polls, 30 per page (the next page loads when the end of the
list is within about two screens). On For you and New, polls you haven't voted on come first, with today's
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
votes per session, 3–5% share rate, D1 ≥30%, D7 ≥12%. Views per day (`views_daily`, added up by the
views rollup) start counting when the live-feed migration runs; `admin_view_stats()` turns them into
votes per 100 views.

**Poll of the Day** is the system poll whose `featured_on` is today's date in India time
(`Asia/Kolkata`). Schedule them in **Admin → Schedule** (`admin_schedule_poll()`); each stays hidden
until its day.

**The leaderboard** is stored in `leader_scores` (top 100 per board per week) and rebuilt every
10 minutes by pg_cron (`docchi-leaders`), or by the first visit after 15 minutes without it. Past
weeks are kept, so last week's champ is a lookup.

## Security

- **The database is only reached through functions.** Tables have row-level security on and no
  grants for `anon` / `authenticated` (`20261119000000_security_hardening.sql` revokes them, and
  the default for future tables), so the REST API can't read or write any table directly. Every
  function the app calls is `security definer` with `set search_path = ''` and checks who's asking.
  **When adding a function:** grant `execute` to exactly the roles that need it, and `revoke ...
  from public, anon, authenticated` on internal helpers (Supabase grants new functions to `anon`
  and `authenticated` by default, so revoking from `public` alone isn't enough).
- **Signed out, only what a visitor needs** (`20261209000000_lockdown.sql`): the anon role can run
  just the functions behind what a signed-out visitor sees and counts (feed, poll, profile,
  leaderboard, live numbers, visits, error reports) and the server's secret-checked job functions;
  the file lists them. Everything else needs a sign-in (guests sign in too, as `authenticated`).
- **Secrets stay on the server:** the service_role key is never in the app; `GOOGLE_CLIENT_SECRET`,
  `VAPID_PRIVATE_KEY`, `PUSH_CRON_SECRET`, `OPENAI_API_KEY` and `RESEND_API_KEY` are server-only (mark them
  **Sensitive** in Vercel). Only the URL, the anon key, the Google client id, the VAPID public key,
  the site URL and the contact email are `NEXT_PUBLIC_`. The server code that reads them
  (`src/lib/push-server.ts`, `email-server.ts`, `google-server.ts`, `server-errors.ts`,
  `text-moderation.ts`, `snap-moderation.ts`, `server-poll.ts`, `admin-gate.ts`) starts with
  `import "server-only"`, so the build fails if a browser component ever imports it.
- **Checking for leaks:** `npm run check:secrets` (`scripts/layout-check/secret-audit.cjs`; the
  commands are at its top). Build and start the app against the pretend Supabase with made-up
  "canary" values for every secret (`OPENAI_API_KEY=sk-CANARY…` and so on); it opens every screen
  signed out, signed in and as the admin with the network log on, and fails if a secret value is in
  any request, response, browser storage or file in `.next/static`, or if a key or token is in an
  address (Supabase Storage's signed snap photo links, `?token=`, short-lived and for one file, are
  the expected exception).
- **Headers** (`next.config.ts`): a Content-Security-Policy (scripts only from this site, network only
  to this site and Supabase, images from Supabase and Google avatars, no framing), HSTS, nosniff,
  `X-Frame-Options: DENY`, a strict referrer policy, and a Permissions-Policy allowing only the
  camera, on this site.
- **Push** subscriptions must point at a real push service (Google, Mozilla, Apple, Microsoft),
  checked in the database and again before sending.
- **Sign-in:** our Google route uses `state` + `nonce` in an httpOnly cookie; after sign-in the app
  only returns to paths on this site.
- **Abuse:** rate limits on votes, comments, polls, snaps, friend requests, shares and blocks;
  reserved usernames (docchi, admin, support…); reports auto-hide content; guest votes only count
  after sign-in. Still to add: CAPTCHA on guest sign-ups and an alert for sudden vote spikes.

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
