import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

export function evaluateCaptureApproval(gates) {
  if (!gates || typeof gates !== 'object' || Array.isArray(gates)) throw new Error('Capture approval must be an object');
  if (gates.candidateCaptureApproved === true && gates.visualApproved === true) {
    throw new Error('Candidate capture approval must not claim the visual target passed');
  }
  if (gates.mechanicsApproved === true && gates.visualApproved === true && gates.fullCaptureApproved === true) {
    return {purpose: 'accepted-showcase', status: 'capture-approved', mechanicsApproved: true, visualReviewed: true, visualTargetPassed: true, knownVisualGaps: [], finalDeliveryApproved: false};
  }
  const gaps = gates.knownVisualGaps;
  const validGaps = Array.isArray(gaps) && gaps.length > 0 && gaps.every(gap => typeof gap === 'string' && gap.trim().length > 0);
  if (gates.mechanicsApproved === true && gates.visualReviewed === true && gates.candidateCaptureApproved === true && gates.visualApproved !== true && validGaps) {
    return {purpose: 'reviewed-candidate-showcase', status: 'candidate-capture-approved', mechanicsApproved: true, visualReviewed: true, visualTargetPassed: false, knownVisualGaps: gaps.map(gap => gap.trim()), finalDeliveryApproved: false};
  }
  throw new Error('Full capture approval file does not pass accepted-showcase or reviewed-candidate gates');
}

export function parseOptions(args, valueFlags, booleanFlags = []) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (booleanFlags.includes(key)) result[key] = true;
    else if (valueFlags.includes(key)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${key}`);
      result[key] = args[++i];
    } else throw new Error(`Unexpected argument: ${key}`);
  }
  return result;
}

export function findProjectRoot(explicit, scriptUrl) {
  const valid = directory => ['package.json', 'world.json', 'contract.json', 'src/main.js'].every(file => fs.existsSync(path.join(directory, file)));
  if (explicit) {
    const directory = path.resolve(explicit);
    if (!valid(directory)) throw new Error(`Invalid --project-root: ${directory}`);
    return directory;
  }
  for (const start of [path.dirname(fileURLToPath(scriptUrl)), process.cwd()]) {
    let directory = path.resolve(start);
    for (;;) {
      if (valid(directory)) return directory;
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  throw new Error('Cannot infer project root. Supply --project-root with package.json, world.json, contract.json and src/main.js.');
}

export function projectRuntime(root, options) {
  const require = createRequire(path.join(root, 'package.json'));
  let playwright;
  try { playwright = require(options['--playwright-path'] ? path.resolve(options['--playwright-path']) : 'playwright'); }
  catch (error) { throw new Error(`Playwright is unavailable in the project. Run npm install or supply --playwright-path. ${error.message}`); }
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  const channel = options['--browser-channel'] || 'chrome';
  return {chromium: playwright.chromium, vite, launchOptions: channel === 'chromium' ? {headless: true} : {headless: true, channel}};
}

export function sourceOverrides(root, options) {
  const overrides = {};
  if (options['--ui-dir']) {
    const directory = path.resolve(options['--ui-dir']);
    for (const file of ['index.html', 'src/main.js', 'src/audio.js', 'src/style.css']) overrides[file] = path.join(directory, file);
  }
  if (options['--physics-dir']) {
    const directory = path.resolve(options['--physics-dir']);
    for (const file of fs.readdirSync(directory)) {
      if (file.endsWith('.js') && !['main.js', 'audio.js', 'scene.js'].includes(file)) overrides[`src/${file}`] = path.join(directory, file);
    }
  }
  if (options['--data-dir']) {
    const directory = path.resolve(options['--data-dir']);
    for (const file of ['contract.json', 'world.json']) overrides[file] = path.join(directory, file);
  }
  for (const [logical, actual] of Object.entries(overrides)) {
    if (!fs.statSync(actual).isFile()) throw new Error(`Override is not a file: ${logical} -> ${actual}`);
  }
  return overrides;
}

export function inventory(root, overrides = {}) {
  const entries = {};
  function add(logical, actual) {
    const bytes = fs.readFileSync(actual);
    entries[logical] = {path: actual, bytes: bytes.length, sha256: sha256(bytes)};
  }
  function walk(folder) {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
      const actual = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(actual);
      else if (/\.(js|mjs|css|html|json|glb|gltf|bin|png|jpe?g|webp|hdr|exr|ktx2?|woff2?)$/i.test(entry.name)) {
        const logical = path.relative(root, actual).replaceAll('\\', '/');
        add(logical, overrides[logical] || actual);
      }
    }
  }
  for (const folder of ['src', 'assets', 'dist']) walk(path.join(root, folder));
  for (const file of ['index.html', 'contract.json', 'world.json', 'package.json', 'package-lock.json', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs', 'vite.config.ts', 'vite.config.mts', 'vite.config.cts', 'tsconfig.json', 'jsconfig.json']) {
    const actual = overrides[file] || path.join(root, file);
    if (fs.existsSync(actual)) add(file, actual);
  }
  for (const [logical, actual] of Object.entries(overrides)) if (!entries[logical]) add(logical, actual);
  return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)));
}

export async function waitForOwnedVite(server, url, timeoutMs = 20000) {
  let output = '', spawnError = null;
  const onData = data => {output = (output + data.toString()).slice(-131072);};
  const onError = error => {spawnError = error;};
  server.stdout.on('data', onData);
  server.stderr.on('data', onData);
  server.on('error', onError);
  const started = Date.now();
  try {
    while (Date.now() - started < timeoutMs) {
      if (spawnError) throw spawnError;
      if (server.exitCode !== null) throw new Error(`Owned Vite server exited (${server.exitCode}): ${output}`);
      // A pre-existing HTTP listener is not ownership proof. Wait for our own
      // strict-port child to announce that it has bound this exact address.
      const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
      if (plain.includes(url)) {
        const response = await fetch(url, {signal: AbortSignal.timeout(2000)});
        if (server.exitCode !== null) throw new Error('Owned Vite server exited during readiness check');
        if (response.ok) return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Owned Vite server did not become ready: ${output}`);
  } finally {
    server.stdout.off('data', onData);
    server.stderr.off('data', onData);
    server.off('error', onError);
  }
}

export async function installOverrides(page, overrides) {
  if (!Object.keys(overrides).length) return;
  await page.route('**/*', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const file = overrides[pathname === '/' ? 'index.html' : pathname.slice(1)];
    if (file) await route.fulfill({path: file, contentType: pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.json') ? 'application/json' : pathname === '/' ? 'text/html' : 'text/javascript'});
    else await route.continue();
  });
}
