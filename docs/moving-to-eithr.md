# Moving from dochhi.vercel.app to eithr.app

Browsers keep sign-ins, Home Screen apps and notification permission per address, so people move
over in one tap instead of all at once.

## How it works (built in)

- **On the old address** (`NEXT_PUBLIC_MOVE_FROM`, default `dochhi.vercel.app`), a sheet says
  "Docchi is now Eithr 🎉" with **Open Eithr →**. It opens the same page on eithr.app and takes
  the sign-in along: the session is passed in the link's `#fragment` (browsers never send that to
  a server), used once and wiped from the address bar, and the old address forgets it locally
  (never via a server sign-out, which would end the session for the new address too).
  Guests keep their guest account, so their votes stay theirs. Signed-out visitors just go to the
  same page. "Later" hides the sheet for that visit.
- **On eithr.app**, `/move` asks "Continue as …?" before using the sign-in (so a link someone else
  made can't sign you into their account), then returns you to the page you were on.
- **Right after**, a "You're in 🎉" sheet offers the two things that can't move: adding Eithr to
  the Home Screen, and turning notifications back on.

Code: `src/lib/move.ts`, `src/components/MoveSheet.tsx`, `MoveArrival.tsx`, `MovedWelcome.tsx`.

## Steps

**Day 1: tell everyone (one notification).** Run once in the Supabase SQL editor, in the daytime
(India time; notifications wait out quiet hours, 11pm to 8am):

```sql
insert into public.notifications (user_id, kind, title, body, url, tag, dedupe)
select distinct s.user_id, 'daily', 'Docchi is now Eithr 👀',
       'Same app, new name. One tap to move over, and you stay signed in.',
       '/?move=1', 'rename', 'rename:' || s.user_id
from public.push_subscriptions s
on conflict (dedupe) do nothing;
```

The link is relative on purpose: phones open it on the address the notification came from (the
old one), where the move sheet carries the sign-in over. It goes out on the next sender run (within
2 minutes). Running it twice does nothing (`dedupe`).

**Day 15: redirect the old address.** Vercel → project → Settings → Domains → `dochhi.vercel.app` →
Edit → **Redirect to Another Domain** → `eithr.app`, **308 Permanent**. Old links then land on the
same page on eithr.app. Anyone who hadn't moved signs in once there (guests who never moved start
fresh; their earlier votes still count in the results).

Before redirecting, check how many people moved:

```sql
-- Devices with notifications on, by address they were set up on (needs a new subscription on eithr.app).
select count(*) filter (where created_at > now() - interval '14 days') as new_subscriptions_14d,
       count(*) as all_subscriptions
from public.push_subscriptions;
```

**After the redirect,** you can remove `NEXT_PUBLIC_MOVE_FROM` handling later; it does nothing on
eithr.app.
