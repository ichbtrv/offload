import assert from 'node:assert/strict';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { configSchema, validate } from '../src/core/schema.js';
import { defaultConfig, loadConfig, saveConfig } from '../src/config/config.js';
import { inspectRequest } from '../src/core/analyze.js';
import { code, fixture } from './helpers.js';

test('trusted config is private, strict, and cannot exceed immutable ceilings', async t => {
  const { root, config } = await fixture(t);
  const file = path.join(root, 'config.json');
  await saveConfig(file, config);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual((await loadConfig(file)).config, config);
  assert.throws(() => validate(configSchema, { ...config, limits: { ...config.limits, maxFiles: 21 } }), code('INVALID_REQUEST'));
  assert.throws(() => validate(configSchema, { ...config, allowSecrets: true }), code('INVALID_REQUEST'));
  await writeFile(file, '{invalid');
  await assert.rejects(loadConfig(file), code('INVALID_REQUEST'));
  await assert.rejects(loadConfig(path.join(root, 'missing.json')), code('PATH_DENIED'));
});

test('repository configuration cannot grant trust, select providers, or raise limits', async t => {
  const { root, request } = await fixture(t);
  await writeFile(path.join(root, '.offload.json'), JSON.stringify({ provider: { type: 'evil' }, limits: { maxFiles: 999 }, allowSecrets: true }));
  const result = await inspectRequest(request, defaultConfig('mock'));
  assert.equal(result.provider.type, 'mock');
  assert.equal(result.limits.maxFiles, 20);
});
