-- Starter system polls so the feed isn't empty. Vote counts start at zero:
-- every number people see is a real vote.
-- Safe to re-run: it only inserts questions that aren't there yet.

with seed(question, options, featured, age_hours, days_open) as (
  values
    ('Tea or coffee to start the day?',               array['Coffee', 'Tea', 'Both, obviously', 'Neither'], true,  0,  1),
    ('Pineapple on pizza: crime or genius?',          array['Crime', 'Genius'],                              false, 2,  3),
    ('Mountains or beaches for a long weekend?',      array['Mountains', 'Beaches'],                         false, 4,  3),
    ('Work from home or office?',                     array['Home, forever', 'Office', 'Hybrid'],           false, 6,  7),
    ('Biryani: Hyderabadi or Kolkata?',               array['Hyderabadi', 'Kolkata', 'Lucknowi', 'Mine is the best'], false, 8, 7),
    ('Best time to watch a movie?',                   array['First day, first show', 'Weekend night', 'When it hits streaming'], false, 10, 3),
    ('Cats or dogs?',                                 array['Cats', 'Dogs', 'Both', 'Neither, I like plants'], false, 12, 7),
    ('Do you reply to messages right away?',          array['Instantly', 'Within an hour', 'Days later', 'Left on read'], false, 14, 3),
    ('Early bird or night owl?',                      array['Early bird', 'Night owl'],                      false, 16, 7),
    ('Window seat or aisle seat?',                    array['Window', 'Aisle', 'Middle (I am a saint)'],     false, 18, 3),
    ('Is a hot dog a sandwich?',                      array['Yes', 'No', 'It is its own thing'],             false, 20, 7),
    ('Chai with biscuits: dip or no dip?',            array['Dip, always', 'No dip', 'Dip until it breaks'], false, 22, 3)
),
new_polls as (
  insert into public.polls (question, is_system, featured_on, created_at, closes_at)
  select
    s.question,
    true,
    case when s.featured then (now() at time zone 'Asia/Kolkata')::date end,
    now() - make_interval(hours => s.age_hours),
    now() - make_interval(hours => s.age_hours) + make_interval(days => s.days_open)
  from seed s
  where not exists (select 1 from public.polls p where p.question = s.question)
  returning id, question
)
insert into public.poll_options (poll_id, position, text)
select np.id, o.ord - 1, o.text
from new_polls np
join seed s on s.question = np.question
cross join lateral unnest(s.options) with ordinality as o(text, ord);
