// A pretend Supabase for the layout check: just enough of the API for the app to
// run, filled with the longest content the app allows (140-character questions,
// 60-character answers, single 60-letter words, 24-character snap answers, a
// 20-character username) in every poll format. Not used by the app itself.
const http = require('http');
const log = [];
const iso = (h) => new Date(Date.now() + h * 36e5).toISOString();
const opt = (p, n, texts) => texts.map((t, i) => ({ id: `${p}-0000-4000-8000-00000000000${i}`, text: t, votes: null, _v: n[i] }));
const mk = (id, q, texts, counts, extra = {}) => ({ id, kind: 'classic', visibility: 'public', is_mine: false, locked: false, audience: null, teaser: null, creator: 'docchi', is_system: true, featured_today: false, vote_count: counts.reduce((a, b) => a + b, 0), share_count: 0, comment_count: 0, created_at: iso(-3), closes_at: iso(40), my_option_id: null, cursor: `1|${id}`, question: q, options: opt(id.slice(0, 8), counts, texts), ...extra });
const U20 = 'averylongusername_20';
const polls = [
  mk('a1000000-0000-4000-8000-000000000001', 'If you had to pick only one of these for the entire rest of your life with absolutely no exceptions whatsoever, which one would you go with?', ['Honestly the long answer that somebody typed out to the max!', 'Honestly the long answer that somebody typed out to the max?', 'Short', 'Supercalifragilisticexpialidociousssssssssssssssssssssssssss'], [5, 4, 3, 2], { creator: U20, is_system: false }),
  mk('a2000000-0000-4000-8000-000000000002', 'SupercalifragilisticexpialidociousssssssssssssssssssssssssssSupercalifragilistic?', ['Supercalifragilisticexpialidociousssssssssssssssssssssssssss', '😂😂😂 Honestly the long answer that somebody t 🔥🔥', 'Supercalifragilisticexpialidoc Supercalifragilisticexpialido'], [9, 1, 0], { creator: U20, is_system: false, featured_today: true }),
  mk('a3000000-0000-4000-8000-000000000003', 'Hot take with a long question that keeps on going and going and going for a while?', ['Honestly the long answer that somebody typed out to the max!', 'Supercalifragilisticexpialidociousssssssssssssssssssssssssss'], [7, 3], { kind: 'take', creator: U20, is_system: false }),
  mk('a4000000-0000-4000-8000-000000000004', 'If you had to pick only one of these for the entire rest of your life with absolutely no exceptions whatsoever, which one would you go with?', ['Honestly the long answer that somebody typed out to the max!', 'Supercalifragilisticexpialidociousssssssssssssssssssssssssss', 'Honestly the long answer that somebody typed out to the max!', 'Honestly the long answer that somebody typed out to the max!'], [1, 2, 3, 4], { kind: 'mystery', teaser: 'Honestly the long answer that somebody typed out to the max!', creator: U20, is_system: false, visibility: 'link' }),
  mk('a5000000-0000-4000-8000-000000000005', 'How do you prefer to sleep', ['Blanket fully cover 🛌🛌🛌', 'No blanket'], [3, 1], { kind: 'snap', creator: U20, is_system: false }),
  mk('a6000000-0000-4000-8000-000000000006', 'Which outfit should I wear tonight for the big party with everyone?', ['Blanket fully covered 🛌', 'Supercalifragilisticexpi', 'A really long answer her', 'Ok'], [3, 1, 2, 2], { kind: 'snap', creator: U20, is_system: false, visibility: 'circle' }),
  mk('a7000000-0000-4000-8000-000000000007', 'Rate it', ['🔥', '😍', '😬', '💀'], [3, 1, 2, 2], { kind: 'snap', creator: U20, is_system: false }),
  mk('a8000000-0000-4000-8000-000000000008', 'Three long ones', ['Supercalifragilisticexpi', 'Supercalifragilisticexpi', 'Supercalifragilisticexpi'], [1, 1, 1], { kind: 'snap', creator: U20, is_system: false }),
];
const votes = {};
let pOffer = null, pUsed = 0, pSeen = false, pOff = false; const pLocked = process.env.PROPS_LOCKED === '1';
const propsS = () => ({ state: pLocked ? 'locked' : pUsed >= 10 ? 'done' : 'ready', left: 10 - pUsed, friends: pLocked ? 2 : 5, off: pOff });
const QS = [['😂', 'Best laugh', 'Who has the best laugh?'], ['🧠', 'Best advice', 'Who gives the best advice?'], ['🍕', 'Best food recommendations', 'Who always knows the best place to eat?']];
const mkOffer = () => { const q = QS[pUsed % QS.length]; return { state: 'ready', offer: 'off-' + pUsed, emoji: q[0], label: q[1], question: q[2], shuffles_left: 2, left: 10 - pUsed, options: ['priya', 'aman', 'zoya', 'ravi'].map((u) => ({ username: u, avatar_url: null })) }; };
const cmts = {};
const deletedMine = new Set(); const visMine = {}; let activitySeen = false;
const files = {}; // path -> {type, buf}
{ const buf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#6cb4ff"/><circle cx="300" cy="330" r="170" fill="#ffd23f" stroke="#1b1530" stroke-width="12"/></svg>'); for (const k of ['a5', 'a6', 'a7', 'a8']) files['u9/' + k + '.jpg'] = { type: 'image/svg+xml', buf }; }
const snaps = { 'a5000000-0000-4000-8000-000000000005': { path: 'u9/a5.jpg', status: 'live', live: true }, 'a6000000-0000-4000-8000-000000000006': { path: 'u9/a6.jpg', status: 'live', live: false }, 'a7000000-0000-4000-8000-000000000007': { path: 'u9/a7.jpg', status: 'live', live: false }, 'a8000000-0000-4000-8000-000000000008': { path: 'u9/a8.jpg', status: 'live', live: false } }; // poll id -> {path, status, live, visibility, question}

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const view = (p) => { const see = !!votes[p.id]; return { ...p, question: p.kind === 'mystery' && !see ? null : p.question, my_option_id: votes[p.id] ?? null, options: p.options.map(({ _v, ...o }) => ({ ...o, votes: see ? _v : null })) }; };
let requests = [{ username: 'zoya', avatar_url: null, at: iso(-1) }];
let members = [{ username: 'priya', avatar_url: null, since: iso(-48), groups: [] }];
const status = { zoya: ['none', 'pending'], priya: ['member', 'member'], aman: ['none', 'none'], ravi: ['none', 'none'] };
const LAT = Number(process.env.LAT || 0);
http.createServer((req, res) => {
  if (LAT && req.method !== 'OPTIONS' && !req.url.startsWith('/__log')) { const orig = res.end.bind(res); res.end = (...args) => { setTimeout(() => orig(...args), LAT); return res; }; }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const body = req.url.startsWith('/storage/') ? '' : raw.toString();
    const url = new URL(req.url, 'http://x');
    const json = (code, data) => { res.writeHead(code, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const a = body ? JSON.parse(body) : {};
    log.push(`${url.pathname} ${body.slice(0, 120)}`);
    if (url.pathname.startsWith('/storage/v1/object/')) {
      const rest = decodeURIComponent(url.pathname.slice('/storage/v1/object/'.length));
      if (req.method === 'POST' && rest.startsWith('snaps/')) { let type = req.headers['content-type'], buf = raw;
        const m = /boundary=(.+)$/.exec(type || '');
        if (m) { const parts = raw.toString('latin1').split('--' + m[1]); const part = parts.find((x) => /Content-Type: image/i.test(x)); const head = part.indexOf('\r\n\r\n'); type = /Content-Type: (\S+)/i.exec(part)[1]; buf = Buffer.from(part.slice(head + 4, part.lastIndexOf('\r\n')), 'latin1'); }
        files[rest.slice(6)] = { type, buf }; log.push('UPLOAD ' + rest + ' ' + raw.length + ' ' + req.headers['content-type']); return json(200, { Key: rest }); }
      if (req.method === 'POST' && rest.startsWith('sign/snaps/')) { const p = rest.slice(11); return json(200, { signedURL: `/object/public-ish/snaps/${p}?token=t` }); }
      if (req.method === 'GET' && (rest.startsWith('public-ish/snaps/') || rest.startsWith('authenticated/snaps/'))) { const p = rest.replace(/^(public-ish|authenticated)\/snaps\//, ''); const f = files[p]; if (!f) return json(404, {}); res.writeHead(200, { ...cors, 'content-type': f.type }); return res.end(f.buf); }
      if (req.method === 'DELETE' && rest === 'snaps') { const a2 = JSON.parse(raw.toString()); for (const p of a2.prefixes) delete files[p]; log.push('REMOVE ' + a2.prefixes.join(',')); return json(200, a2.prefixes.map((n) => ({ name: n }))); }
    }
    switch (url.pathname.replace('/rest/v1/rpc/', '')) {
      case 'create_snap': {
        if (!files[a.photo_path]) return json(400, { message: 'docchi:no_photo' });
        const id = 'bbbbbbbb-0000-4000-8000-00000000000' + polls.length;
        log.push('CREATE ' + JSON.stringify({ q: a.question, answers: a.answers, vis: a.visibility, template: a.template }));
        if (!a.answers || a.answers.length < 2) return json(400, { message: 'docchi:answer_count' });
        const t = [a.question, a.answers];
        polls.unshift(mk(id, t[0], t[1], t[1].map(() => 0), { kind: 'snap', visibility: a.visibility, creator: 'mayank', is_system: false, is_mine: true, created_at: iso(0), closes_at: iso(24) }));
        snaps[id] = { path: a.photo_path, status: 'pending', live: a.live, visibility: a.visibility, question: t[0] };
        return json(200, id);
      }
      case 'snap_for_check': { const s2 = snaps[a.poll]; return json(200, s2 && s2.status === 'pending' ? [{ photo_path: s2.path, visibility: s2.visibility, question: s2.question }] : []); }
      case 'set_snap_verdict': { if (a.secret !== 'test-secret-test-secret-123') return json(400, { message: 'docchi:bad_secret' }); snaps[a.poll].status = a.verdict; snaps[a.poll].scores = a.scores; log.push('VERDICT ' + a.verdict + ' ' + JSON.stringify(a.scores).slice(0, 80)); return json(200, a.verdict); }
      case 'snap_info': return json(200, a.ids.filter((i) => snaps[i]).map((i) => ({ poll_id: i, photo_path: snaps[i].path, photo_status: snaps[i].status, photo_live: snaps[i].live })));
      case 'admin_snaps': return json(200, Object.entries(snaps).filter(([, v]) => v.status === 'review').map(([k, v]) => ({ poll_id: k, photo_path: v.path, question: v.question, visibility: v.visibility, creator: 'mayank', created_at: iso(0), photo_status: v.status, photo_scores: v.scores })));
      case 'admin_decide_snap': snaps[a.poll].status = a.approve ? 'live' : 'rejected'; return json(200, null);
      case 'expired_snap_photos': return json(200, []);
      case 'delete_poll': { if (a.poll.startsWith('6')) { deletedMine.add(a.poll); log.push('DELETE ' + a.poll); return json(200, null); } const i = polls.findIndex((p) => p.id === a.poll); if (i < 0 || !polls[i].is_mine) return json(400, { message: 'docchi:not_yours' }); polls.splice(i, 1); log.push('DELETE ' + a.poll); return json(200, null); }
      case 'best_rank': log.push('BEST ' + JSON.stringify(a)); return json(200, a.name === 'aman' ? null : { rank: a.name ? 7 : 3, week: '2026-10-12' });
      case 'my_storage_files': log.push('FILES'); return json(200, ['u1/old-snap.webp']);
      case 'delete_my_account': log.push('DELETE_ACCOUNT ' + a.confirm); return a.confirm.trim().toUpperCase() === 'DELETE' ? json(200, null) : json(400, { message: 'docchi:confirm' });
      case 'props_state': return json(200, propsS());
      case 'next_prop': { const st = propsS(); if (st.state !== 'ready') return json(200, st); if (!pOffer) pOffer = mkOffer(); return json(200, pOffer); }
      case 'shuffle_prop': { if (!pOffer || pOffer.shuffles_left === 0) return json(400, { message: 'docchi:no_shuffles' }); pOffer = { ...pOffer, shuffles_left: pOffer.shuffles_left - 1, options: [['sanyam'], ['neha'], ['zoya'], ['kabir']].map(([u]) => ({ username: u, avatar_url: null })) }; log.push('SHUFFLE'); return json(200, pOffer); }
      case 'give_prop': { if (!pOffer || !pOffer.options.some((o) => o.username === a.username)) return json(400, { message: 'docchi:not_an_option' }); pUsed++; log.push('GIVE ' + a.username); pOffer = null; return json(200, propsS()); }
      case 'skip_prop': pUsed++; pOffer = null; log.push('SKIP'); return json(200, propsS());
      case 'my_props': return json(200, { total: 17, new: pSeen ? 0 : 2, items: [{ emoji: '😂', label: 'Best laugh', count: 7, new: pSeen ? 0 : 2 }, { emoji: '🧠', label: 'Best advice', count: 5, new: 0 }, { emoji: '🍕', label: 'Best food recommendations', count: 3, new: 0 }, { emoji: '🎤', label: 'Best singer', count: 2, new: 0 }] });
      case 'props_news': return json(200, pSeen ? 0 : 2);
      case 'mark_props_seen': pSeen = true; log.push('PROPS_SEEN'); return json(200, null);
      case 'set_props_off': pOff = a.off; log.push('PROPS_OFF ' + a.off); return json(200, null);
      case 'mark_snap_photos_deleted': log.push('MARK ' + a.paths.join(',')); return json(200, null);
      case '/__log': return json(200, log);
      case 'get_feed': return json(200, (a.tab === 'circle' ? [polls.find((p) => p.visibility === 'circle')] : polls).filter((p) => p.kind !== 'snap' || snaps[p.id]?.status === 'live').map(view));
      case 'get_poll': return json(200, polls.filter((p) => p.id === a.poll).map(view));
      case 'cast_vote': { votes[a.target_poll] = a.target_option; const p = polls.find((x) => x.id === a.target_poll); p.vote_count++; p.options.find((o) => o.id === a.target_option)._v++; const v = view(p); return json(200, [{ my_option_id: v.my_option_id, vote_count: v.vote_count, question: p.question, options: v.options }]); }
      case 'friends_voted': return json(200, a.poll === polls[0].id ? { count: 3, people: [{ username: U20, avatar_url: null }, { username: 'zoya', avatar_url: null }, { username: 'aman', avatar_url: null }] } : { count: 0, people: [] });
      case 'circle_picks': return json(200, [{ username: 'priya', avatar_url: null, option_id: polls[1].options[0].id, is_me: false }]);
      case 'record_open': return json(200, null);
      case 'track_visit': return json(200, null);
      case 'circle_badge': return json(200, { requests: requests.length, accepted_recently: 0 });
      case 'my_activity': if (activitySeen) return json(200, { votes: 0, comments: 0, polls: [] }); return json(200, { votes: 5, comments: 1, polls: [{ poll_id: '99999999-0000-4000-8000-000000000009', question: 'Pineapple on pizza?', votes: 5, comments: 1 }] });
      case 'mark_activity_seen': activitySeen = true; log.push('SEEN'); return json(200, null);
      case 'my_profile': return json(200, { is_admin: true,  username: 'mayank', username_confirmed: true, avatar_url: null, joined: iso(-500), polls_made: 2, votes_received: 40, shares: 3, votes_cast: 10 });
      case 'my_polls': {
        const mineList = [
          mk('61000000-0000-4000-8000-000000000001', 'Mittal ke shadi me dance karna hai ki nai bhai??', ['Haan', 'Nahi'], [2, 0], { visibility: 'link', creator: 'mayank', is_system: false, is_mine: true, share_count: 1, closes_at: iso(45) }),
          mk('62000000-0000-4000-8000-000000000002', 'What reason to leave your desk? 😜', ['Chai', 'Smoke', 'Gossip'], [1, 1, 2], { creator: 'mayank', is_system: false, is_mine: true, share_count: 1, closes_at: iso(44) }),
          mk('63000000-0000-4000-8000-000000000003', 'Weekend plan: Lonavala or Netflix?', ['Lonavala', 'Netflix'], [6, 3], { visibility: 'circle', audience: 'Whole circle', creator: 'mayank', is_system: false, is_mine: true, share_count: 3, closes_at: iso(20) }),
          mk('64000000-0000-4000-8000-000000000004', 'Best chai spot near office?', ['Tapri', 'Cafe', 'Pantry'], [12, 11, 8], { creator: 'mayank', is_system: false, is_mine: true, share_count: 6, created_at: iso(-80), closes_at: iso(-2) }),
        ].filter((p) => !deletedMine.has(p.id)).map((p) => ({ ...p, visibility: visMine[p.id] ?? p.visibility, options: p.options.map(({ _v, ...o }) => ({ ...o, votes: _v })) }));
        return json(200, a.which === 'voted' ? polls.filter((p) => votes[p.id]).map(view) : mineList);
      }
      case 'set_poll_visibility': visMine[a.poll] = a.visibility; log.push('VIS ' + a.poll + ' ' + a.visibility); return json(200, null);
      case 'get_push_settings': return json(200, null);
      case 'my_circle': return json(200, { requests, members, groups: [{ id: 'g1', name: 'Family', count: 0 }], joined: [{ username: 'ravi', avatar_url: null, status: 'pending', at: iso(-2) }, ...members.map((m) => ({ ...m, status: 'member', at: m.since }))] });
      case 'suggest_friends': return json(200, [{ username: 'aman', avatar_url: null, mutual: 2, voted: 0 }, { username: 'neha', avatar_url: null, mutual: 0, voted: 3 }]);
      case 'my_invite_code': return json(200, 'abc123def456');
      case 'search_people': return json(200, Object.entries(status).filter(([n]) => n.startsWith(a.q)).map(([n, s]) => ({ username: n, avatar_url: null, their_circle: s[0], my_circle: s[1] })));
      case 'request_circle': { const s = status[a.name] ?? ['none', 'none']; const r = s[1] === 'pending' ? 'member' : 'pending'; status[a.name] = r === 'member' ? ['member', 'member'] : ['pending', s[1]]; return json(200, r); }
      case 'respond_request': requests = requests.filter((r) => r.username !== a.name); if (a.accept) { members.push({ username: a.name, avatar_url: null, since: iso(0), groups: [] }); status[a.name] = ['member', 'member']; } else status[a.name] = ['none', 'none']; return json(200, null);
      case 'leave_circle': members = members.filter((m) => m.username !== a.name); status[a.name] = ['none', 'none']; return json(200, null);
      case 'accept_invite': if (a.code !== 'goodcode') return json(400, { message: 'docchi:bad_invite' }); status[a.name] = ['member', 'member']; return json(200, 'member');
      case 'get_profile': { const s = status[a.name] ?? ['none', 'none']; return json(200, { username: a.name, avatar_url: null, joined: iso(-200), is_me: a.name === 'mayank', public_polls: 2, votes_received: 30, circle_size: 4, their_circle: s[0], my_circle: s[1], blocked_by_me: false }); }
      case 'profile_polls': return json(200, []);
      case 'create_poll_status': return json(200, { signed_in: true, username: 'mayank', suggestions: [], polls_left: 4, special_left: 1 });
      case 'create_poll': { const id = 'aaaaaaaa-0000-4000-8000-00000000000' + polls.length; polls.unshift(mk(id, a.question, a.answers, a.answers.map(() => 0), { creator: 'mayank', is_system: false, is_mine: true, created_at: iso(0) })); return json(200, id); }
      case 'my_streak': return json(200, Object.keys(votes).length ? { current: 3, best: 5, today: true } : { current: 2, best: 5, today: false });
      case 'recent_results': return json(200, [{ poll_id: polls[0].id, question: 'Mountains or beaches?', kind: 'classic', vote_count: 40, winner: 'Beaches', winner_pct: 62, my_pick: 'Beaches', mine: false, closed_at: iso(-2) }, { poll_id: polls[1].id, question: 'Is cereal soup?', kind: 'hot_take', vote_count: 12, winner: 'Disagree', winner_pct: 75, my_pick: 'Agree', mine: false, closed_at: iso(-5) }]);
      case 'get_comments': return json(200, { can_read: true, can_post: true, closed: false, comments: (cmts[a.poll] || []) });
      case 'post_comment': (cmts[a.poll] ||= []).push({ id: 'c' + Date.now(), text: a.body, created_at: new Date().toISOString(), username: 'mayank', avatar_url: null, pick: null, pick_index: null, is_mine: true, is_creator: false, can_delete: true }); return json(200, null);
    }
    json(404, { message: 'not mocked' });
  });
}).listen(54339, () => console.log('mock Supabase on :54339'));
