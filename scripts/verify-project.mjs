import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const args of [
  [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'],
  [path.join(root, 'scripts/test-mechanics.mjs')],
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    if (result.error) console.error(result.error.message);
    process.exit(result.status || 1);
  }
}
console.log('Production build and mechanics verification passed. Visual, motion and listening acceptance are separate.');
