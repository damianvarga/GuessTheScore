const { req, check, csrf, registerAndLogin, summary } = require('./helpers');

const uname = 'lg' + Date.now() + Math.floor(Math.random() * 1000);

(async () => {
  const owner = await registerAndLogin(uname + 'o');
  const member = await registerAndLogin(uname + 'm');
  const outsider = await registerAndLogin(uname + 'x');

  let r = await req('GET', '/leagues', { cookies: owner });
  let t = csrf(r);
  check('owner leagues page 200', r.status, 200);
  r = await req('POST', '/leagues', { cookies: owner, body: { _csrf: t, name: 'Test League' } });
  const leagueId = (r.headers.location || '').match(/\/leagues\/(\d+)/)?.[1];
  check('create league redirect 302', r.status, 302);
  check('league id extracted', leagueId || 'none', leagueId || 'none');

  r = await req('GET', `/leagues/${leagueId}`, { cookies: owner });
  const code = (r.body.match(/class="invite-code">([^<]+)</) || [])[1];
  check('league page has invite code', code ? 'yes' : 'no', 'yes');
  check('invite code length 6', code ? code.length : 0, 6);

  r = await req('GET', '/leagues', { cookies: member });
  t = csrf(r);
  r = await req('POST', '/leagues/join', { cookies: member, body: { _csrf: t, code } });
  check('join league 302', r.status, 302);

  r = await req('GET', `/leagues/${leagueId}/admin`, { cookies: owner });
  check('owner admin page 200', r.status, 200);
  r = await req('GET', `/leagues/${leagueId}/admin`, { cookies: member });
  check('member admin blocked 403', r.status, 403);

  t = csrf(r);
  r = await req('GET', `/leagues/${leagueId}/admin`, { cookies: owner });
  t = csrf(r);
  const future = new Date(Date.now() + 48 * 3600 * 1000);
  const dt = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}T${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
  r = await req('POST', `/leagues/${leagueId}/games`, { cookies: owner, body: { _csrf: t, phase: 'group', home_team: 'Brazil', away_team: 'Argentina', start_time: dt } });
  check('create game 302', r.status, 302);

  r = await req('GET', `/leagues/${leagueId}/admin`, { cookies: owner });
  const gameId = (r.body.match(/games\/(\d+)\/result/) || [])[1];
  check('game id extracted', gameId || 'none', gameId || 'none');

  r = await req('GET', `/leagues/${leagueId}/games`, { cookies: member });
  t = csrf(r);
  r = await req('POST', `/leagues/${leagueId}/games/${gameId}/predict`, { cookies: member, body: { _csrf: t, home_score: '2', away_score: '1' } });
  check('member predict 302', r.status, 302);

  r = await req('POST', `/leagues/${leagueId}/games/${gameId}/predict`, { cookies: member, body: { home_score: '1', away_score: '1' } });
  check('predict without csrf 403', r.status, 403);

  r = await req('GET', `/leagues/${leagueId}/games`, { cookies: outsider });
  check('outsider games blocked 302', r.status, 302);

  r = await req('GET', `/leagues/${leagueId}/admin`, { cookies: owner });
  t = csrf(r);
  r = await req('POST', `/leagues/${leagueId}/games/${gameId}/result`, { cookies: owner, body: { _csrf: t, home_score: '2', away_score: '1' } });
  check('set result 302', r.status, 302);

  r = await req('GET', `/leagues/${leagueId}/rankings`, { cookies: member });
  check('rankings 200', r.status, 200);
  const memberName = uname + 'm';
  const rowMatch = r.body.match(new RegExp(`<td class="rank-player">${memberName}`));
  const pts = (r.body.match(/rank-points">(\d+)/) || [])[1];
  check('member appears in rankings', rowMatch ? 'yes' : 'no', 'yes');
  check('member has points (exact score 10)', pts || 'none', '10');

  r = await req('GET', '/leagues', { cookies: member });
  t = csrf(r);
  r = await req('POST', '/leagues', { cookies: member, body: { _csrf: t, name: 'League 2' } });
  const league2Id = (r.headers.location || '').match(/\/leagues\/(\d+)/)?.[1];
  check('member created league2', league2Id || 'none', league2Id || 'none');
  r = await req('GET', `/leagues/${league2Id}/games`, { cookies: member });
  check('league2 games page 200', r.status, 200);
  r = await req('GET', `/leagues/${league2Id}/games`, { cookies: owner });
  check('owner not in league2 (302)', r.status, 302);

  r = await req('GET', `/leagues/${leagueId}`, { cookies: owner });
  t = csrf(r);
  r = await req('POST', `/leagues/${leagueId}/delete`, { cookies: owner, body: { _csrf: t } });
  check('owner deletes league 302', r.status, 302);

  summary();
})().catch(e => { console.error(e); process.exit(1); });
