import { spawn } from 'child_process';
import fs from 'fs';

const profileDir = `/tmp/lw_twitch_debug_${Date.now()}`;
fs.mkdirSync(profileDir, { recursive: true });

console.log('Testing https://www.twitch.tv with LibreWolf...');
const child = spawn('librewolf', [
  '--headless',
  '--no-remote',
  '--profile', profileDir,
  '--screenshot', '/tmp/twitch_screen.png',
  'https://www.twitch.tv'
], {
  env: { ...process.env, MOZ_HEADLESS: '1' }
});

child.stdout.on('data', d => console.log('[STDOUT]', d.toString()));
child.stderr.on('data', d => console.error('[STDERR]', d.toString()));

setTimeout(() => {
  child.kill('SIGKILL');
  console.log('Done test.');
  process.exit(0);
}, 15000);
