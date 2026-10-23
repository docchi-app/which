-- Docchi starter pack: about 50 system polls for the friends beta.
-- Run once in the Supabase SQL Editor (after the migrations and seed.sql).
-- Safe to re-run: questions that already exist are skipped. Dates are
-- relative to when you run it, in India time.
--
-- What it adds:
--   * Poll of the Day for each of the next 14 days (unlocks at 00:00 IST,
--     open for 3 days)
--   * One new poll a day for the next 15 days (unlocks at 09:00 IST, open
--     for 7 days), so the New tab and the "Fresh polls" pill stay alive
--   * 14 evergreen polls, live now, open for 30 days
--   * Keeps the original seed.sql polls open for 30 more days
--
-- Light topics only: no politics, religion or real people.

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
-- kind: 'daily' = Poll of the Day on day n; 'drip' = goes live on day n;
--       'now'   = live now.
with pack(kind, day, question, options) as (
  values
    -- Poll of the Day, days 1–14
    ('daily',  1, 'Monsoon evening: chai and pakoras or a long drive?', array['Chai and pakoras', 'Long drive', 'Stay in bed']),
    ('daily',  2, 'Best way to eat a mango?', array['Sliced', 'Straight off the seed', 'Aamras', 'Mango shake']),
    ('daily',  3, 'Give up WhatsApp or Instagram for a year?', array['Give up WhatsApp', 'Give up Instagram']),
    ('daily',  4, 'Your ideal Sunday?', array['Sleep till noon', 'Brunch with friends', 'Binge a series', 'Get outdoors']),
    ('daily',  5, 'Maggi: plain or loaded?', array['Plain, always', 'Loaded with veggies', 'Extra masala', 'Cheese on top']),
    ('daily',  6, 'Test cricket or T20?', array['Test, the real deal', 'T20 all the way', 'ODI, the middle path']),
    ('daily',  7, 'Movie night: theatre or home?', array['Theatre, big screen', 'Home with snacks']),
    ('daily',  8, 'Pani puri, bhel puri or sev puri?', array['Pani puri', 'Bhel puri', 'Sev puri']),
    ('daily',  9, 'Biggest letdown at a wedding buffet?', array['Paneer runs out', 'No dessert counter', 'Cold rotis', 'The queue']),
    ('daily', 10, 'Unlimited free travel or unlimited free food?', array['Free travel', 'Free food']),
    ('daily', 11, 'Text, call or voice note?', array['Text, always', 'Just call me', 'Voice notes']),
    ('daily', 12, 'New Year''s Eve: hills, beach or house party?', array['Hill station', 'Beach', 'House party']),
    ('daily', 13, 'The best Indian sweet?', array['Gulab jamun', 'Rasgulla', 'Jalebi', 'Kaju katli']),
    ('daily', 14, 'Morning gym or late-night walk?', array['Morning gym', 'Late-night walk', 'Neither, couch']),

    -- One new poll a day, days 1–15
    ('drip',  1, 'Cereal first or milk first?', array['Cereal first', 'Milk first', 'No cereal, ever']),
    ('drip',  2, 'Auto or cab for a short trip?', array['Auto', 'Cab', 'Walk it']),
    ('drip',  3, 'Best breakfast?', array['Poha', 'Idli', 'Paratha', 'Upma']),
    ('drip',  4, 'Ten minutes early or ten minutes late?', array['Early', 'Late', 'On the dot']),
    ('drip',  5, 'Do you hit reply-all on office emails?', array['Never', 'Only when needed', 'Every single time']),
    ('drip',  6, 'Best day of the week?', array['Friday', 'Saturday', 'Sunday']),
    ('drip',  7, 'Read the book or watch the movie?', array['Book first', 'Movie first', 'Only the movie']),
    ('drip',  8, 'Which dosa?', array['Plain', 'Masala', 'Paper', 'Rava']),
    ('drip',  9, 'How many browser tabs are open right now?', array['Under 5', '5 to 20', '20 to 50', 'I''ve lost count']),
    ('drip', 10, 'Is your Wi-Fi name a joke?', array['Yes, a good one', 'No, it''s boring', 'Great idea, brb']),
    ('drip', 11, 'Best time for chai?', array['Morning', '4 pm', 'Late night', 'All of the above']),
    ('drip', 12, 'Dogs in the office?', array['Yes please', 'No thanks', 'Cats instead']),
    ('drip', 13, 'Weekend trip: plan everything or wing it?', array['Plan everything', 'Wing it']),
    ('drip', 14, 'Which one do you skip first: breakfast or dinner?', array['Breakfast', 'Dinner', 'Never skip a meal']),
    ('drip', 15, 'Group trip roles: which one are you?', array['The planner', 'The photographer', 'The one who''s late', 'The snack bag']),

    -- Evergreen, live now
    ('now', 0, 'Rain: love it or hate it?', array['Love it', 'Hate it', 'Only from a window']),
    ('now', 0, 'Pick a superpower', array['Fly', 'Invisibility', 'Teleport', 'Read minds']),
    ('now', 0, 'Time travel: past or future?', array['The past', 'The future']),
    ('now', 0, 'Best pizza topping?', array['Paneer tikka', 'Mushroom', 'Pepperoni', 'Extra cheese']),
    ('now', 0, 'How spicy do you go?', array['Mild', 'Medium', 'Properly spicy', 'Make me cry']),
    ('now', 0, 'Cold coffee or hot coffee?', array['Cold', 'Hot']),
    ('now', 0, 'How do you eat a samosa?', array['Bite straight in', 'Break it open', 'With chutney', 'With chole']),
    ('now', 0, 'Do you sing in the shower?', array['Every day', 'Sometimes', 'Never', 'Full concert']),
    ('now', 0, 'Best way to travel?', array['Train', 'Flight', 'Road trip', 'Bike']),
    ('now', 0, 'Your phone at night?', array['Silent', 'Loud', 'Do not disturb']),
    ('now', 0, 'Live in the mountains or by the sea?', array['Mountains', 'By the sea']),
    ('now', 0, 'Ketchup on everything?', array['Yes', 'No', 'Only on fries']),
    ('now', 0, 'Morning shower or night shower?', array['Morning', 'Night', 'Both']),
    ('now', 0, 'Best board game?', array['Ludo', 'Carrom', 'Monopoly', 'Chess'])
),
timed as (
  select
    p.*,
    (now() at time zone 'Asia/Kolkata')::date + p.day as on_date
  from pack p
  where not exists (select 1 from public.polls x where x.question = p.question)
),
new_polls as (
  insert into public.polls (question, is_system, featured_on, created_at, closes_at)
  select
    t.question,
    true,
    -- Skip a date that already has a Poll of the Day.
    case when t.kind = 'daily'
          and not exists (select 1 from public.polls x where x.featured_on = t.on_date)
         then t.on_date end,
    case t.kind
      when 'daily' then t.on_date::timestamp at time zone 'Asia/Kolkata'
      when 'drip'  then (t.on_date + time '09:00') at time zone 'Asia/Kolkata'
      else now()
    end,
    case t.kind
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
cross join lateral unnest(p.options) with ordinality as o(text, ord);
