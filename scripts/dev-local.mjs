#!/usr/bin/env node
/**
 * PR-6 — one-command local workbench: `pnpm dev:local`.
 *
 * Loads the repo-root .env (if present), then fills in workbench defaults
 * (LOCAL_MODE + inline queue processing) WITHOUT overriding anything already
 * set in the real environment or in .env — e.g. IMAGE_PROVIDER=kie in .env
 * stays in effect. Never prints loaded values (may contain secrets).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseEnvFile(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

const env = { ...process.env };

const envFile = path.join(root, '.env');
if (existsSync(envFile)) {
  for (const [key, value] of Object.entries(parseEnvFile(envFile))) {
    if (env[key] === undefined) env[key] = value;
  }
}

const defaults = {
  LOCAL_MODE: '1',
  INSPECT_INLINE: '1',
  GENERATION_INLINE: '1',
};
for (const [key, value] of Object.entries(defaults)) {
  if (env[key] === undefined) env[key] = value;
}

const isWin = process.platform === 'win32';
const pnpm = isWin ? 'pnpm.cmd' : 'pnpm';
const child = spawn(pnpm, ['--filter', '@studio/web', 'dev'], {
  cwd: root,
  env,
  stdio: 'inherit',
  // Windows: spawning a .cmd shim without a shell throws EINVAL on modern Node.
  shell: isWin,
});

child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
