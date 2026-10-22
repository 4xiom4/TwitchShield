import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const USERSCRIPT_HEADER = `// ==UserScript==
// @name         TwitchShield
// @namespace    https://github.com/4xiom4/TwitchShield
// @version      38.0.0
// @description  Bloqueo de anuncios en Twitch de cero latencia, silencioso, con extracción dinámica de tokens GraphQL y sincronización HLS.
// @author       4xiom4 & contributors
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
  console.log('[Build] Compilando TwitchShield con esbuild...');

  const mainResult = await esbuild.build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    write: false,
    minify: false
  });

  const mainCode = mainResult.outputFiles[0].text;

  const distDir = path.resolve('dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // 1. Userscript (Violentmonkey / Tampermonkey)
  const userScriptContent = USERSCRIPT_HEADER + mainCode;
  fs.writeFileSync(path.join(distDir, 'twitch-shield.user.js'), userScriptContent, 'utf-8');

  // 2. uBlock Origin
  const ublockContent = UBLOCK_HEADER + mainCode + UBLOCK_FOOTER;
  fs.writeFileSync(path.join(distDir, 'twitch-shield.ublock.js'), ublockContent, 'utf-8');

  const elapsed = Date.now() - startTime;
  console.log(`[Build] Compilación completada en ${elapsed}ms:`);
  console.log(`  -> dist/twitch-shield.user.js (${(userScriptContent.length / 1024).toFixed(1)} KB)`);
  console.log(`  -> dist/twitch-shield.ublock.js (${(ublockContent.length / 1024).toFixed(1)} KB)`);
}

build().catch((err) => {
  console.error('[Build] Error fatal:', err);
  process.exit(1);
});
