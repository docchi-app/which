-- Lockdown: database functions a signed-out visitor never calls can't be called signed out.
--
-- Supabase lets the anon role (anyone with the public key, no sign-in) run every function in
-- public unless it's revoked. The app calls the functions below only when someone is signed in.
-- Most of them refuse, or do nothing, without a sign-in; a few answered anyone (search_people
-- found people by name, check_username said whether a name is taken) and now don't. Guests
-- (anonymous accounts) sign in as authenticated, so they're unaffected. Signed-in people keep
-- exactly what they had.
--
-- Still open to the anon role, on purpose (checked against every call in src/):
--   what a signed-out visitor sees: get_feed, get_poll, get_profile, profile_polls, best_rank,
--     get_leaderboard, live_counts, snap_info, get_comments (says "sign in"), create_poll_status
--     (says signed_in false), snap_photo_visible (the snap photos' storage policy)
--   counting: track_visit, record_visitor, email_opened, report_error, record_open and
--     record_share (both do nothing signed out)
--   the server, with the public key and PUSH_CRON_SECRET: push_collect, push_gone, push_tally,
--     push_test_targets, errors_tick, morning_summary, email_summary_collect, email_unsubscribe,
--     record_views_anon, report_server_error, texts_to_check, set_text_verdict
-- A function added later is open to anon unless its migration revokes it (as the recent ones
-- do). The migration check (supabase/checks/migration-check.sql) names any function closed here
-- that is open again.
--
-- Only grants change. A function that isn't there (a migration that hasn't run) is skipped with
-- a notice; run this again after that migration. Safe to run twice.

do $$
declare
  f text;
begin
  foreach f in array array[
    -- Admin (each also checks for the admin inside).
    'admin_act(text, uuid, text)',
    'admin_decide_snap(uuid, boolean)',
    'admin_log(int)',
    'admin_reports(text)',
    'admin_schedule(int)',
    'admin_schedule_poll(date, text, text[], text, text, int, uuid)',
    'admin_snaps()',
    'admin_unschedule(uuid)',
    -- Friends, lists and blocking.
    'accept_invite(text, text)',
    'block_user(text)',
    'circle_badge()',
    'circle_picks(uuid)',
    'create_group(text)',
    'delete_group(uuid)',
    'leave_circle(text)',
    'my_circle()',
    'my_invite_code()',
    'remove_from_circle(text)',
    'rename_group(uuid, text)',
    'request_circle(text)',
    'respond_request(text, boolean)',
    'search_people(text)',
    'set_group_member(uuid, text, boolean)',
    'suggest_friends()',
    'unblock_user(text)',
    -- Props.
    'give_prop(uuid, text)',
    'mark_props_seen()',
    'my_props()',
    'next_prop()',
    'props_news()',
    'props_state()',
    'set_props_off(boolean)',
    'shuffle_prop(uuid)',
    'skip_prop(uuid)',
    -- Notifications on this device.
    'delete_push_subscription(text)',
    'get_push_settings()',
    'save_push_subscription(text, text, text)',
    'set_push_settings(boolean, boolean, boolean, boolean, boolean, boolean)',
    -- Snaps: the creator's own check (/api/snap/check calls these with their sign-in) and photo clean-up.
    'expired_snap_photos(boolean)',
    'mark_snap_photos_deleted(text[])',
    'set_snap_verdict(uuid, text, jsonb, text)',
    'snap_for_check(uuid)',
    -- Your own profile, polls, comments and activity.
    'check_username(text)',
    'delete_comment(uuid)',
    'delete_poll(uuid)',
    'mark_activity_seen()',
    'my_activity()',
    'my_profile()',
    'my_streak()',
    'note_blocked(text)',
    'recent_results()',
    'update_username(text)',
    'username_suggestions(text)'
  ] loop
    if to_regprocedure('public.' || f) is null then
      raise notice 'lockdown: public.% is missing, skipped', f;
    else
      execute format('revoke execute on function public.%s from public, anon', f);
      execute format('grant execute on function public.%s to authenticated', f);
    end if;
  end loop;
end;
$$;
