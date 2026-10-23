-- Docchi starter pack: 49 verified system polls for the friends beta,
-- mixing classic polls, hot takes and mystery polls.
-- Run once in the Supabase SQL Editor (after the migrations and seed.sql).
-- Safe to re-run: questions that already exist are skipped. Dates are
-- relative to when you run it, in India time.
--
-- What it adds:
--   * Poll of the Day for each of the next 14 days (unlocks at 00:00 IST,
--     open for 3 days)
--   * One new poll a day for the next 15 days (unlocks at 09:00 IST, open
--     for 7 days), so the New tab and the "Fresh polls" pill stay alive
--   * 20 evergreen polls, live now, open for 30 days
--   * Keeps the original seed.sql polls open for 30 more days
--
-- Light topics only: no politics, religion or real people.
-- Columns: kind, day, question, teaser (mystery only), answers
-- (hot takes always get Agree / Disagree).

-- ─── Keep the original starter polls open ─────────────────────────────────
update public.polls
set closes_at = greatest(closes_at, now() + interval '30 days')
where is_system
  and closes_at > now()
  and question in (
    'Pineapple on pizza: crime or genius?', 'Mountains or beaches for a long weekend?',
    'Work from home or office?', 'Biryani: Hyderabadi or Kolkata?', 'Best time to watch a movie?',
    'Cats or dogs?', 'Do you reply to messages right away?', 'Early bird or night owl?',
    'Window seat or aisle seat?', 'Is a hot dog a sandwich?', 'Chai with biscuits: dip or no dip?'
  );

-- ─── The pack ─────────────────────────────────────────────────────────────
-- slot: 'daily' = Poll of the Day on day n; 'drip' = goes live on day n;
--       'now'   = live now.
with pack(slot, day, kind, question, teaser, options) as (
  values
    -- Poll of the Day, days 1–14
    ('daily',  1, 'classic',  'Your friend says "5 minutes, leaving now". How long do you actually wait?', null,
       array['5 minutes, I trust people', '20 minutes', 'An hour, I know them', 'I haven''t left either']),
    ('daily',  2, 'mystery',  'Where would you go if you quit your job tomorrow?', 'Pick a place. Don''t overthink it.',
       array['Mountains', 'A beach shack', 'A new city', 'My bed']),
    ('daily',  3, 'hot_take', 'Idli is boring. The chutney is doing all the work.', null, null),
    ('daily',  4, 'classic',  '₹1 crore today or ₹1 lakh every month for life?', null,
       array['₹1 crore today', '₹1 lakh a month for life']),
    ('daily',  5, 'classic',  'Which member of the family WhatsApp group are you?', null,
       array['Good morning flower sender', 'The forwarder', 'The silent reader', 'The one who left']),
    ('daily',  6, 'mystery',  'How many hours could you last without your phone?', 'Pick a number',
       array['1', '3', '7', '12']),
    ('daily',  7, 'hot_take', 'Dal chawal beats biryani on a weeknight.', null, null),
    ('daily',  8, 'classic',  'Would you rather have your search history or your chats read out at a family dinner?', null,
       array['My search history', 'My chats', 'I''d move countries']),
    ('daily',  9, 'classic',  'How many alarms do you set in the morning?', null,
       array['Just 1', '2 to 3', '4 to 6', 'A full playlist']),
    ('daily', 10, 'mystery',  'What colour is your dream car?', 'Pick a colour',
       array['Red', 'Black', 'White', 'Electric blue']),
    ('daily', 11, 'hot_take', 'Going to the movies alone is underrated.', null, null),
    ('daily', 12, 'classic',  'Go back to school with everything you know now?', null,
       array['Yes, I''d top the class', 'No way', 'Only for the canteen']),
    ('daily', 13, 'hot_take', 'Voice notes longer than one minute should be illegal.', null, null),
    ('daily', 14, 'mystery',  'Which animal are you before your morning chai?', 'Pick an animal',
       array['Sloth', 'Grumpy cat', 'Owl', 'Golden retriever']),

    -- One new poll a day, days 1–15
    ('drip',  1, 'classic',  'How many unread WhatsApp messages do you have right now?', null,
       array['Zero, I''m a monster', 'Under 50', 'Under 500', '999+']),
    ('drip',  2, 'hot_take', 'Cold pizza for breakfast beats hot pizza for dinner.', null, null),
    ('drip',  3, 'classic',  'The worst kind of meeting?', null,
       array['Could''ve been an email', 'Starts 10 minutes late', 'Cameras on, please', '"Quick 5-minute call"']),
    ('drip',  4, 'mystery',  'Which one are you at a party?', 'Pick a snack',
       array['Chips', 'Samosa', 'Popcorn', 'Chocolate']),
    ('drip',  5, 'classic',  'Group project: which one were you?', null,
       array['Did everything', 'Made the slides pretty', 'Vanished', 'Presented it all']),
    ('drip',  6, 'hot_take', 'The window seat person should control the window shade.', null, null),
    ('drip',  7, 'classic',  'Abroad on holiday: hunt for Indian food or eat only local?', null,
       array['Indian food every day', 'Once, when homesick', 'Only local, that''s the point']),
    ('drip',  8, 'classic',  'Free Wi-Fi everywhere forever, or never wait in a queue again?', null,
       array['Free Wi-Fi forever', 'No queues ever']),
    ('drip',  9, 'mystery',  'When do your best ideas show up?', 'Pick a time',
       array['6 am', '2 pm', '11 pm', '3 am']),
    ('drip', 10, 'classic',  'The real reason people order a samosa?', null,
       array['The potato', 'The crust', 'The chutney', 'The chai next to it']),
    ('drip', 11, 'hot_take', 'Reply-all should need a password.', null, null),
    ('drip', 12, 'classic',  'Best childhood thing?', null,
       array['Sunday morning cartoons', 'Collecting stickers', 'Video game parlours', 'Trump cards']),
    ('drip', 13, 'classic',  'What''s your phone battery at right now?', null,
       array['Under 20%', '20 to 50%', '50 to 80%', '80% and up']),
    ('drip', 14, 'mystery',  'What''s your honest texting style?', 'Pick a word',
       array['Hahaha', 'Okay.', 'lol', 'Seen']),
    ('drip', 15, 'hot_take', 'Wedding food is the real reason anyone goes to weddings.', null, null),

    -- Evergreen, live now
    ('now', 0, 'classic',  'You find ₹500 on the road. What do you do?', null,
       array['Keep it', 'Look for the owner', 'Give it away', 'Chai for everyone']),
    ('now', 0, 'classic',  'Which friend are you in the group chat?', null,
       array['The planner', 'The meme sender', 'Reacts, never replies', 'Typing… forever']),
    ('now', 0, 'classic',  'Most annoying thing in a movie theatre?', null,
       array['Bright phone screens', 'Loud chewing', 'Seat kickers', 'Spoilers out loud']),
    ('now', 0, 'classic',  'Famous or rich?', null,
       array['Famous', 'Rich', 'Neither, just let me sleep']),
    ('now', 0, 'classic',  'Your food order is late. What do you do?', null,
       array['Track it every 10 seconds', 'Call the restaurant', 'Snack while waiting', 'Fall asleep']),
    ('now', 0, 'classic',  'Lose your phone or your wallet?', null,
       array['Phone', 'Wallet']),
    ('now', 0, 'classic',  'Best time to watch a horror movie?', null,
       array['Never', 'Daytime only', 'Midnight, alone', 'With friends']),
    ('now', 0, 'classic',  'Pick a superpower', null,
       array['Fly', 'Invisibility', 'Teleport', 'Read minds']),
    ('now', 0, 'classic',  'How spicy do you go?', null,
       array['Mild', 'Medium', 'Properly spicy', 'Make me cry']),
    ('now', 0, 'classic',  'Cereal first or milk first?', null,
       array['Cereal first', 'Milk first', 'No cereal, ever']),
    ('now', 0, 'classic',  'Which dosa?', null,
       array['Plain', 'Masala', 'Paper', 'Rava']),
    ('now', 0, 'classic',  'How many browser tabs are open right now?', null,
       array['Under 5', '5 to 20', '20 to 50', 'I''ve lost count']),
    ('now', 0, 'classic',  'Best time for chai?', null,
       array['Morning', '4 pm', 'Late night', 'All of the above']),
    ('now', 0, 'hot_take', 'Roadside chai beats fancy café chai. Every time.', null, null),
    ('now', 0, 'hot_take', 'Sunday evening is worse than Monday morning.', null, null),
    ('now', 0, 'hot_take', 'Unboxing is better than the thing inside.', null, null),
    ('now', 0, 'hot_take', 'Leaving a party without saying bye is polite.', null, null),
    ('now', 0, 'mystery',  'What''s your vibe on a Monday morning?', 'Pick a drink',
       array['Black coffee', 'Masala chai', 'Green tea', 'Energy drink']),
    ('now', 0, 'mystery',  'Where would you live if rent didn''t exist?', 'Pick a city',
       array['Mumbai', 'Bengaluru', 'Goa', 'Shimla']),
    ('now', 0, 'mystery',  'What would play in the movie about your life?', 'Pick a sound',
       array['Pressure cooker whistle', 'Rain on a tin roof', 'Auto horn', 'Kettle boiling'])
),
timed as (
  select
    p.*,
    (now() at time zone 'Asia/Kolkata')::date + p.day as on_date
  from pack p
  where not exists (select 1 from public.polls x where x.question = p.question)
),
new_polls as (
  insert into public.polls (question, kind, teaser, is_system, featured_on, created_at, closes_at)
  select
    t.question,
    t.kind,
    t.teaser,
    true,
    -- Skip a date that already has a Poll of the Day.
    case when t.slot = 'daily'
          and not exists (select 1 from public.polls x where x.featured_on = t.on_date)
         then t.on_date end,
    case t.slot
      when 'daily' then t.on_date::timestamp at time zone 'Asia/Kolkata'
      when 'drip'  then (t.on_date + time '09:00') at time zone 'Asia/Kolkata'
      else now()
    end,
    case t.slot
      when 'daily' then t.on_date::timestamp at time zone 'Asia/Kolkata' + interval '3 days'
      when 'drip'  then (t.on_date + time '09:00') at time zone 'Asia/Kolkata' + interval '7 days'
      else now() + interval '30 days'
    end
  from timed t
  returning id, question
)
insert into public.poll_options (poll_id, position, text)
select np.id, o.ord - 1, o.text
from new_polls np
join pack p on p.question = np.question
cross join lateral unnest(
  case when p.kind = 'hot_take' then array['Agree', 'Disagree'] else p.options end
) with ordinality as o(text, ord);
