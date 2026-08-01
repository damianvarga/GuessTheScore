const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = parseInt(process.env.TEST_PORT, 10) || 3100;
const PROJECT = path.join(__dirname, '..');
const SERVER = path.join(PROJECT, 'server.js');
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-test-'));
const DB = path.join(TEMP, 'test.db');

function startServer(extraEnv) {
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(PORT),
    DB_PATH: DB,
    DB_BACKUP_INTERVAL_MINUTES: '0',
    DB_BACKUP_KEEP: '2',
    ...extraEnv
  };
  const child = spawn(process.execPath, [SERVER], { cwd: PROJECT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const handle = { child, stdout: '', stderr: '' };
  child.stdout.on('data', d => handle.stdout += d);
  child.stderr.on('data', d => handle.stderr += d);
  return handle;
}

function waitReady(handle, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (handle.stdout.includes('Server running')) {
        clearInterval(timer);
        resolve();
      } else if (handle.child.exitCode !== null) {
        clearInterval(timer);
        reject(new Error(`Server exited before ready (code ${handle.child.exitCode}):\n${handle.stderr}`));
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for server. Output:\n${handle.stdout}\n${handle.stderr}`));
      }
    }, 100);
  });
}

function stopServer(handle) {
  return new Promise(resolve => {
    handle.child.once('exit', () => resolve());
    handle.child.kill();
    setTimeout(() => resolve(), 2000);
  });
}

function runSuite(file) {
  return new Promise(resolve => {
    const suite = spawn(process.execPath, [path.join(__dirname, file)], {
      cwd: PROJECT,
      env: { ...process.env, TEST_PORT: String(PORT) },
      stdio: ['ignore', 'inherit', 'inherit']
    });
    suite.on('exit', code => resolve(code === 0));
  });
}

async function phase(label, env, files) {
  console.log(`\n=== ${label} ===`);
  const srv = startServer(env);
  await waitReady(srv);
  let ok = true;
  for (const f of files) {
    const passed = await runSuite(f);
    if (!passed) ok = false;
  }
  await stopServer(srv);
  return ok;
}

async function main() {
  let ok = true;
  try {
    const p1 = await phase('Phase 1: ads disabled', {}, ['league.test.js', 'confirm.test.js', 'adsense-off.test.js']);
    const p2 = await phase('Phase 2: ads enabled', { ADSENSE_CLIENT: 'ca-pub-1234567890123456', ADSENSE_AD_SLOT: '1234567890' }, ['adsense-on.test.js']);
    ok = p1 && p2;
  } catch (err) {
    console.error(`\nTest run failed: ${err.message}`);
    ok = false;
  } finally {
    try { fs.rmSync(TEMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
  console.log(`\nOverall: ${ok ? 'ALL SUITES PASSED' : 'SOME SUITES FAILED'}`);
  process.exit(ok ? 0 : 1);
}

main();
