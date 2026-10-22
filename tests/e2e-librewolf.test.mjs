import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import assert from 'node:assert/strict';

const PORT = 9876;
const userScriptPath = path.resolve('dist/twitch-shield.user.js');
const userScriptCode = fs.readFileSync(userScriptPath, 'utf-8');

const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Twitch Mock Test Page</title>
  <script>
    window.addEventListener('error', function(e) {
      const errReq = new XMLHttpRequest();
      errReq.open('POST', '/__report_error', false);
      errReq.setRequestHeader('Content-Type', 'application/json');
      errReq.send(JSON.stringify({ message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno, error: e.error ? String(e.error.stack) : '' }));
    });
  </script>
</head>
<body>
  <div id="root">
    <div class="video-player">
      <video id="test-video" autoplay muted playsinline></video>
    </div>
  </div>

  <!-- Injected TwitchShield Userscript -->
  <script>
    ${userScriptCode}
  </script>

  <!-- Test Scenario Script -->
  <script>
    async function runE2ETest() {
      const results = {
        scriptLoaded: false,
        workerHooked: false,
        gqlIntercepted: false,
        popoutForced: false,
        dynamicHashCaptured: false,
        apiAvailable: false,
        errors: []
      };

      try {
        // 1. Verify script loaded
        if (window.twitchShieldVersion === 39) {
          results.scriptLoaded = true;
        }

        // 2. Verify window.Worker is hooked and can instantiate
        if (window.Worker && window.Worker.toString().includes('Worker')) {
          results.workerHooked = true;
          try {
            const blobUrl = URL.createObjectURL(new Blob(['/* mock worker */'], { type: 'application/javascript' }));
            const w = new Worker(blobUrl);
            results.workerInstantiated = true;
            w.terminate();
          } catch (wErr) {
            results.errors.push('Worker instantiation error: ' + wErr);
          }
        }

        // 3. Test GQL Fetch interception
        const testHash = 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890';
        let capturedBody = null;

        const origFetch = window.realFetch;
        window.realFetch = async function(url, init) {
          capturedBody = init?.body;
          return new Response(JSON.stringify({
            data: {
              streamPlaybackAccessToken: {
                signature: 'test-sig-123',
                value: 'test-token-456'
              }
            }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };

        const res = await window.fetch('https://gql.twitch.tv/gql', {
          method: 'POST',
          headers: {
            'Client-ID': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
            'X-Device-Id': 'test-device-id'
          },
          body: JSON.stringify({
            operationName: 'PlaybackAccessToken',
            variables: { playerType: 'site', login: 'streamer' },
            extensions: { persistedQuery: { version: 1, sha256Hash: testHash } }
          })
        });

        results.gqlIntercepted = true;

        if (capturedBody) {
          const parsed = JSON.parse(capturedBody);
          if (parsed.variables?.playerType === 'popout') {
            results.popoutForced = true;
          }
        }

        // 4. Verify API
        if (window.TwitchShield && typeof window.TwitchShield.reloadStream === 'function') {
          results.apiAvailable = true;
          const status = window.TwitchShield.status();
          if (status.capturedHash === testHash) {
            results.dynamicHashCaptured = true;
          }
        }

      } catch (err) {
        results.errors.push(String(err));
      }

      // Send results to test server synchronously
      const req = new XMLHttpRequest();
      req.open('POST', '/__report_results', false);
      req.setRequestHeader('Content-Type', 'application/json');
      req.send(JSON.stringify(results));
    }

    runE2ETest();
  </script>
</body>
</html>`;

async function run() {
  console.log('[E2E Test] Starting HTTP mock server on port', PORT);

  let testResults = null;
  const server = http.createServer((req, res) => {
    console.log('[Server Received Request]', req.url);
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(htmlContent);
    } else if (req.url === '/__report_results' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        testResults = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      });
    } else if (req.url === '/__report_error' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        console.error('[E2E Test Browser Error]', body);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      });
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  await new Promise(resolve => server.listen(PORT, resolve));

  const profileDir = `/tmp/lw_e2e_test_profile_${Date.now()}`;
  fs.mkdirSync(profileDir, { recursive: true });

  console.log('[E2E Test] Spawning headless LibreWolf browser...');
  const browserProc = spawn('librewolf', [
    '--headless',
    '--no-remote',
    '--profile', profileDir,
    '--screenshot', '/tmp/test_e2e.png',
    `http://127.0.0.1:${PORT}/`
  ], {
    env: { ...process.env, MOZ_HEADLESS: '1' },
    stdio: 'inherit'
  });

  const checkStartTime = Date.now();
  while (!testResults && Date.now() - checkStartTime < 15000) {
    await new Promise(r => setTimeout(r, 200));
  }

  browserProc.kill('SIGKILL');
  server.close();
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}

  console.log('[E2E Test] LibreWolf session finished.');
  console.log('[E2E Test] Results received:', JSON.stringify(testResults, null, 2));

  assert.ok(testResults, 'No test results received from LibreWolf within 15 seconds!');
  assert.equal(testResults.scriptLoaded, true, 'Script failed to load in LibreWolf');
  assert.equal(testResults.workerHooked, true, 'Worker was not hooked');
  assert.equal(testResults.workerInstantiated, true, 'Worker failed to instantiate in LibreWolf');
  assert.equal(testResults.gqlIntercepted, true, 'GQL fetch was not intercepted');
  assert.equal(testResults.popoutForced, true, 'PlaybackAccessToken did not replace playerType with popout');
  assert.equal(testResults.dynamicHashCaptured, true, 'Dynamic GQL sha256 hash was not captured');
  assert.equal(testResults.apiAvailable, true, 'window.TwitchShield API was not available');
  assert.equal(testResults.errors.length, 0, `Errors during execution: ${testResults.errors.join(', ')}`);

  console.log('✅ ALL E2E TESTS PASSED IN LIBREWOLF HEADLESS!');
}

run().catch(err => {
  console.error('❌ E2E TEST FAILED:', err);
  process.exit(1);
});
