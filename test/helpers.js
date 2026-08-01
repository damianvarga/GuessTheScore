const http = require('http');

const PORT = parseInt(process.env.TEST_PORT, 10) || 3100;

function req(method, path, { cookies = [], body = null } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? new URLSearchParams(body).toString() : null;
    const options = {
      hostname: 'localhost', port: PORT, path, method,
      headers: {
        ...(cookies.length ? { Cookie: cookies.join('; ') } : {}),
        ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const r = http.request(options, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        const setCookies = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]);
        resolve({ status: res.statusCode, headers: res.headers, body: chunks, setCookies });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let pass = 0, fail = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${actual} (expected ${expected})`);
}

const CSRF_RE = /name="_csrf" value="([^"]+)"/;

function csrf(page) {
  return (page.body.match(CSRF_RE) || [])[1];
}

async function registerAndLogin(username) {
  let r = await req('GET', '/register');
  let t = csrf(r);
  let cookies = r.setCookies;
  await req('POST', '/register', { cookies, body: { _csrf: t, username, password: 'Password123', confirmPassword: 'Password123' } });
  r = await req('GET', '/login');
  t = csrf(r);
  cookies = r.setCookies;
  r = await req('POST', '/login', { cookies, body: { _csrf: t, username, password: 'Password123' } });
  return r.setCookies;
}

function summary() {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

module.exports = { req, check, csrf, registerAndLogin, summary, PORT };
