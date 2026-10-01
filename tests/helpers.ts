import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { OffloadError, type ErrorCode } from '../src/core/errors.js';
import { defaultConfig } from '../src/config/config.js';

export async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'offload-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'session.ts'), 'export function expired(now: number, end: number) {\n  return now >= end;\n}\n');
  const config = defaultConfig('mock');
  config.limits.contextTokens = 64000;
  return { root, config, request: { root, paths: ['session.ts'], question: 'Where is expiration checked?' } };
}

export function code(expected: ErrorCode) {
  return (error: unknown): boolean => error instanceof OffloadError && error.code === expected;
}
