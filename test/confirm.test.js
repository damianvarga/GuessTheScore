const { req, check, csrf, registerAndLogin, summary } = require('./helpers');

const uname = 'cf' + Date.now() + Math.floor(Math.random() * 1000);

(async () => {
  let r = await req('GET', '/confirm.js');
  check('confirm.js serves 200', r.status, 200);
  check('confirm.js has submit listener', r.body.includes('data-confirm') && r.body.includes('window.confirm') ? 'yes' : 'no', 'yes');

  r = await req('GET', '/inputs.js');
  check('inputs.js serves 200', r.status, 200);

  const owner = await registerAndLogin(uname + 'o');
  r = await req('GET', '/leagues', { cookies: owner });
  check('leagues page 200', r.status, 200);
  let t = csrf(r);
  r = await req('POST', '/leagues', { cookies: owner, body: { _csrf: t, name: 'Confirm Test League' } });
  const leagueId = (r.headers.location || '').match(/\/leagues\/(\d+)/)?.[1];
  check('create league 302', r.status, 302);

  r = await req('GET', `/leagues/${leagueId}`, { cookies: owner });
  check('league page 200', r.status, 200);
  check('league page uses data-confirm', r.body.includes('data-confirm="') ? 'yes' : 'no', 'yes');
  check('league page has no inline onsubmit', r.body.includes('onsubmit') ? 'no' : 'yes', 'yes');
  check('league page loads confirm.js', r.body.includes('src="/confirm.js"') ? 'yes' : 'no', 'yes');

  r = await req('GET', `/leagues/${leagueId}/admin`, { cookies: owner });
  check('admin page 200', r.status, 200);
  check('admin page has no inline onsubmit', r.body.includes('onsubmit') ? 'no' : 'yes', 'yes');
  check('admin page loads confirm.js', r.body.includes('src="/confirm.js"') ? 'yes' : 'no', 'yes');

  summary();
})().catch(e => { console.error(e); process.exit(1); });
