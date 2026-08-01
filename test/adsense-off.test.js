const { req, check, csrf, registerAndLogin, summary } = require('./helpers');

const uname = 'ao' + Date.now() + Math.floor(Math.random() * 1000);

(async () => {
  let r = await req('GET', '/login');
  check('login 200', r.status, 200);
  check('no adsense meta', r.body.includes('google-adsense-account') ? 'no' : 'yes', 'yes');
  check('no consent banner', r.body.includes('consent-banner') ? 'no' : 'yes', 'yes');
  check('no consent.js', r.body.includes('consent.js') ? 'no' : 'yes', 'yes');
  const csp = r.headers['content-security-policy'] || '';
  check('CSP locked (no ad domains)', (csp.includes('pagead2') || csp.includes('googlesyndication')) ? 'no' : 'yes', 'yes');

  r = await req('GET', '/robots.txt');
  check('robots.txt 200', r.status, 200);
  r = await req('GET', '/favicon.svg');
  check('favicon.svg 200', r.status, 200);

  r = await req('GET', '/definitely-not-a-page');
  check('404 status', r.status, 404);
  check('404 styled', r.body.includes('Page not found') ? 'yes' : 'no', 'yes');

  r = await req('GET', '/_test-500');
  check('500 status', r.status, 500);
  check('500 styled', r.body.includes('Something went wrong') ? 'yes' : 'no', 'yes');

  r = await req('GET', '/about');
  check('about 200', r.status, 200);
  check('about no banner', r.body.includes('consent-banner') ? 'no' : 'yes', 'yes');
  r = await req('GET', '/privacy');
  check('privacy 200', r.status, 200);

  const owner = await registerAndLogin(uname + 'o');
  r = await req('GET', '/leagues', { cookies: owner });
  let t = csrf(r);
  r = await req('POST', '/leagues', { cookies: owner, body: { _csrf: t, name: 'Ads Off League' } });
  const leagueId = (r.headers.location || '').match(/\/leagues\/(\d+)/)?.[1];
  r = await req('GET', `/leagues/${leagueId}`, { cookies: owner });
  check('league 200', r.status, 200);
  check('league no ad unit', r.body.includes('data-ad-client') ? 'no' : 'yes', 'yes');
  check('league has footer', r.body.includes('site-footer') ? 'yes' : 'no', 'yes');

  summary();
})().catch(e => { console.error(e); process.exit(1); });
