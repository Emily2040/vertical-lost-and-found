import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = '.run/verification';
const commands = [
  ['route.mjs', '--project-root=.', `--output-dir=${out}`],
  ['route.mjs', '--project-root=.', `--output-dir=${out}`, '--decision-ms=80', '--output-prefix=sensitivity-80-'],
  ['route.mjs', '--project-root=.', `--output-dir=${out}`, '--decision-ms=120', '--output-prefix=sensitivity-120-'],
  ['route.mjs', '--project-root=.', `--output-dir=${out}`, '--showcase', '--output-prefix=showcase-'],
  ['qualify.mjs', '--project-root=.', `--evidence-dir=${out}`],
  ['independent-mechanics.mjs', '--project-root=.', `--output-dir=${out}`],
  ['contact-qualify.mjs', '--project-root=.', `--output-dir=${out}`],
];
for (const [script, ...args] of commands) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    console.error(result.error || result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
  console.log(`PASS ${script}${args.includes('--showcase') ? ' (showcase)' : ''}`);
}
const reports = ['mechanics-evidence.json', 'independent-mechanics-evidence.json', 'contact-geometry-evidence.json']
  .map(name => JSON.parse(fs.readFileSync(path.join(root, out, name), 'utf8')));
const checks = reports.flatMap(report => report.checks);
if (reports.some(report => report.allPassed !== true) || checks.some(check => check.passed !== true)) {
  throw new Error('A saved mechanics report contains a failed check.');
}
console.log(`${checks.length} mechanics checks passed. Four ordinary-control routes completed. Evidence: ${out}/`);
