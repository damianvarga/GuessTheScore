const { req, check, csrf, registerAndLogin, summary } = require('./helpers');

const uname = 'an' + Date.now() + Math.floor(Math.random() * 1000);

(async () => {
  let r = await req('GET', '/login');
  check('login has adsense meta', r.body.includes('google-adsense-account') ? 'yes' : 'no', 'yes');
  check('login has consent banner', r.body.includes('consent-banner') ? 'yes' : 'no', 'yes');
  check('login has consent.js', r.body.includes('src="/consent.js"') ? 'yes' : 'no', 'yes');
  const csp = r.headers['content-security-policy'] || '';
  check('CSP allows pagead2', csp.includes('pagead2.googlesyndication.com') ? 'yes' : 'no', 'yes');
  check('CSP allows doubleclick frame', csp.includes('googleads.g.doubleclick.net') ? 'yes' : 'no', 'yes');

  r = await req('GET', '/consent.js');
  check('consent.js 200', r.status, 200);

  r = await req('GET', '/about');
  check('about 200', r.status, 200);
  check('about has banner', r.body.includes('consent-banner') ? 'yes' : 'no', 'yes');
  r = await req('GET', '/privacy');
  check('privacy 200', r.status, 200);

  const owner = await registerAndLogin(uname + 'o');
  r = await req('GET', '/leagues', { cookies: owner });
  let t = csrf(r);
  r = await req('POST', '/leagues', { cookies: owner, body: { _csrf: t, name: 'Ads On League' } });
  const leagueId = (r.headers.location || '').match(/\/leagues\/(\d+)/)?.[1];

  r = await req('GET', `/leagues/${leagueId}/admin`, { cookies: owner });
  t = csrf(r);
  const future = new Date(Date.now() + 48 * 3600 * 1000);
  const dt = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}T${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`;
  await req('POST', `/leagues/${leagueId}/games`, { cookies: owner, body: { _csrf: t, phase: 'group', home_team: 'Brazil', away_team: 'Argentina', start_time: dt } });

  r = await req('GET', `/leagues/${leagueId}`, { cookies: owner });
  check('league has ad unit', r.body.includes('data-ad-client') ? 'yes' : 'no', 'yes');
  check('league has banner', r.body.includes('consent-banner') ? 'yes' : 'no', 'yes');
  check('league has footer', r.body.includes('site-footer') ? 'yes' : 'no', 'yes');

  r = await req('GET', `/leagues/${leagueId}/games`, { cookies: owner });
  check('games has ad unit', r.body.includes('data-ad-client') ? 'yes' : 'no', 'yes');

  r = await req('GET', `/leagues/${leagueId}/rankings`, { cookies: owner });
  check('rankings has ad unit', r.body.includes('data-ad-client') ? 'yes' : 'no', 'yes');

  r = await req('GET', `/leagues/${leagueId}/admin`, { cookies: owner });
  check('admin NO ad unit (by design)', r.body.includes('data-ad-client') ? 'no' : 'yes', 'yes');
  check('admin has banner', r.body.includes('consent-banner') ? 'yes' : 'no', 'yes');

  summary();
})().catch(e => { console.error(e); process.exit(1); });
