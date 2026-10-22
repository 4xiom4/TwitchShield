import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const USERSCRIPT_HEADER = `// ==UserScript==
// @name         TwitchShield
// @namespace    https://github.com/4xiom4/TwitchShield
// @version      1.0.0
// @description  Zero-latency, high-performance Twitch ad evasion with dynamic GraphQL token extraction & HLS continuity alignment.
// @match        *://*.twitch.tv/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==
`;

const UBLOCK_HEADER = `twitch-videoad.js text/javascript
(function() {
if ( /(^|\.)twitch\.tv$/.test(document.location.hostname) === false ) { return; }
`;

const UBLOCK_FOOTER = `
})();
`;

async function build() {
  const startTime = Date.now();
  console.log('[Build] Compiling worker bundle...');

  // 1. Bundle worker
  const workerResult = await esbuild.build({
    entryPoints: ['src/worker/worker-main.ts'],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    write: false,
    minify: false
  });

  const workerCode = workerResult.outputFiles[0].text;
  console.log(`[Build] Worker bundle compiled (${(workerCode.length / 1024).toFixed(1)} KB)`);

  // 2. Bundle main script with inlined worker code
  console.log('[Build] Compiling main bundle with inlined worker...');
  const mainResult = await esbuild.build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    write: false,
    minify: false,
    define: {
      __INJECTED_WORKER_CODE__: JSON.stringify(workerCode)
    }
  });

  const mainCode = mainResult.outputFiles[0].text;

  // 3. Prepare output directory
  const distDir = path.resolve('dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // 4. Generate Userscript version
  const userScriptContent = USERSCRIPT_HEADER + mainCode;
  fs.writeFileSync(path.join(distDir, 'twitch-shield.user.js'), userScriptContent, 'utf-8');

  // 5. Generate uBlock Origin version
  const ublockContent = UBLOCK_HEADER + mainCode + UBLOCK_FOOTER;
  fs.writeFileSync(path.join(distDir, 'twitch-shield.ublock.js'), ublockContent, 'utf-8');

  const elapsed = Date.now() - startTime;
  console.log(`[Build] Build complete in ${elapsed}ms!`);
  console.log(`  -> dist/twitch-shield.user.js (${(userScriptContent.length / 1024).toFixed(1)} KB)`);
  console.log(`  -> dist/twitch-shield.ublock.js (${(ublockContent.length / 1024).toFixed(1)} KB)`);
}

build().catch((err) => {
  console.error('[Build] Fatal build error:', err);
  process.exit(1);
});
