import esbuild from 'esbuild';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const testFiles = fs.readdirSync('tests').filter(f => f.endsWith('.test.mjs'));

async function runTests() {
  for (const file of testFiles) {
    const filePath = path.join('tests', file);
    const result = await esbuild.build({
      entryPoints: [filePath],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false
    });

    await new Promise((resolve, reject) => {
      const child = spawn('node', ['--input-type=module', '-'], {
        stdio: ['pipe', 'inherit', 'inherit']
      });
      child.stdin.write(result.outputFiles[0].text);
      child.stdin.end();
      child.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`Test ${file} failed with exit code ${code}`));
      });
    });
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
