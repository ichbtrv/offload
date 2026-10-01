import assert from 'node:assert/strict';
import { copyFile, chmod, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../src/process/run.js';
import { fixture } from './helpers.js';

const cli = fileURLToPath(new URL('../src/cli/main.js', import.meta.url));
const fakeSource = path.resolve('tests/fixtures/fake-cli.mjs');

async function command(args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}) {
  return runProcess({ executable: process.execPath, args: [cli, ...args, '--json'], cwd: process.cwd(), ...options });
}

test('CLI supports file and stdin JSON, emits a single envelope, and rejects ambiguous flags', async t => {
  const { request, root } = await fixture(t);
  const file = path.join(root, 'request.json');
  await writeFile(file, JSON.stringify(request));
  for (const source of [file, '-']) {
    const result = await command(['read', '--provider', 'mock', '--request-file', source], { input: JSON.stringify(request) });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout.trim().split('\n').length, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.schemaVersion, 1);
    assert.equal(typeof envelope.requestId, 'string');
  }
  const invalid = await command(['read', '--provider', 'mock', '--request-file', file, '--question', 'ambiguous']);
  assert.equal(invalid.exitCode, 2);
  assert.equal(JSON.parse(invalid.stdout).error.code, 'INVALID_REQUEST');
  const malformed = await command(['read', '--provider', 'mock', '--request-file', '-'], { input: '{' });
  assert.equal(malformed.exitCode, 2);
});

test('CLI dry-run never requires authentication; JSON errors never leak payloads', async t => {
  const { request } = await fixture(t);
  const result = await command(['read', '--request-file', '-', '--dry-run'], { input: JSON.stringify(request) });
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.stdout).result.dryRun, true);
  const invalid = await command(['read', '--provider', 'mock', '--request-file', '-'], { input: JSON.stringify({ ...request, unexpected: 'private-secret-do-not-return' }) });
  assert.equal(invalid.exitCode, 2);
  assert.equal(invalid.stdout.includes('private-secret-do-not-return'), false);
});

test('mock initialization writes private config once and doctor exposes provenance', async t => {
  const { root } = await fixture(t);
  const config = path.join(root, 'offload-config.json');
  assert.equal((await command(['init', '--provider', 'mock', '--config', config])).exitCode, 0);
  assert.equal((await command(['init', '--provider', 'mock', '--config', config])).exitCode, 12);
  const doctor = await command(['doctor', '--config', config]);
  assert.equal(JSON.parse(doctor.stdout).result.ready, true);
  assert.equal(JSON.parse(doctor.stdout).result.provenance, config);
});

test('fake Claude end-to-end: consent, bounded stdin, safe args, provenance, errors and no fallback', async t => {
  const { root, request } = await fixture(t);
  const executable = path.join(root, 'fixture-claude.mjs');
  await copyFile(fakeSource, executable);
  await chmod(executable, 0o700);
  const configPath = path.join(root, 'worker.json');
  const record = path.join(root, 'record.json');
  const env = { ...process.env, OFFLOAD_FAKE_RECORD: record };
  const initArgs = ['init', '--provider', 'claude-cli', '--executable', executable, '--model', 'claude-fixture-1', '--context-tokens', '16000', '--config', configPath];
  const preview = await command(initArgs, { env });
  assert.equal(preview.exitCode, 0, preview.stdout);
  assert.equal(JSON.parse(preview.stdout).result.saved, false);
  await assert.rejects(readFile(configPath));
  const init = await command([...initArgs, '--authorize-remote'], { env });
  assert.equal(init.exitCode, 0, init.stdout);
  const readArgs = ['read', '--config', configPath, '--request-file', '-'];
  const result = await command(readArgs, { env, input: JSON.stringify(request) });
  assert.equal(result.exitCode, 0, result.stdout);
  assert.equal(JSON.parse(result.stdout).result.usage.inputTokens, 100);
  const recorded = JSON.parse(await readFile(record, 'utf8'));
  assert.equal(recorded.worker, '1');
  assert.equal(recorded.args.includes(request.question), false);
  assert.equal(recorded.args[recorded.args.indexOf('--tools') + 1], '');
  assert.notEqual(recorded.cwd, await realpath(root));
  assert.equal(JSON.parse(recorded.input).sources.length, 1);
  await assert.rejects(readFile(path.join(recorded.cwd, 'anything')));
  for (const [mode, expected] of [['no-login', 'AUTH_REQUIRED'], ['unsupported-version', 'WORKER_POLICY_UNSUPPORTED'], ['malformed', 'OUTPUT_INVALID'], ['nonzero', 'PROVIDER_UNAVAILABLE'], ['oversized', 'OUTPUT_TRUNCATED']]) {
    const failed = await command(readArgs, { env: { ...env, OFFLOAD_FAKE_MODE: mode }, input: JSON.stringify(request) });
    assert.equal(JSON.parse(failed.stdout).error.code, expected, failed.stdout);
    assert.equal(failed.stdout.includes('private-secret-do-not-return'), false);
  }
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.provider.model = 'claude-other-1';
  await writeFile(configPath, JSON.stringify(config));
  const changed = await command(readArgs, { env, input: JSON.stringify(request) });
  assert.equal(JSON.parse(changed.stdout).error.code, 'REMOTE_NOT_AUTHORIZED');
});

test('Codex fixture is diagnosed but never invoked for inference without verified isolation', async t => {
  const { root } = await fixture(t);
  const executable = path.join(root, 'fixture-codex.mjs');
  await copyFile(fakeSource, executable);
  await chmod(executable, 0o700);
  const result = await command(['init', '--provider', 'codex-cli', '--executable', executable, '--model', 'fixture', '--context-tokens', '16000', '--authorize-remote', '--config', path.join(root, 'codex.json')]);
  assert.equal(JSON.parse(result.stdout).error.code, 'WORKER_POLICY_UNSUPPORTED');
});

test('native CLI prepare/complete/discard works without a standalone provider', async t => {
  const { root, request } = await fixture(t);
  const env = { ...process.env, XDG_CONFIG_HOME: root };
  const prepared = await command(['prepare', '--host', 'claude', '--request-file', '-'], { env, input: JSON.stringify(request) });
  assert.equal(prepared.exitCode, 0, prepared.stdout);
  const job = JSON.parse(prepared.stdout).result;
  t.after(async () => { await command(['discard', '--job', job.job], { env }); });
  assert.equal(prepared.stdout.includes('return now >= end'), false);
  await writeFile(job.answerFile, JSON.stringify({
    answer: 'The check compares now with end.',
    findings: [{ sourceId: 's1', startLine: 2, endLine: 2, quote: 'return now >= end;', explanation: 'Equality is expired too.' }],
    coverage: { status: 'complete', inspectedSourceIds: ['s1'], omissions: [] }, warnings: [], unresolvedQuestions: [],
  }));
  const completed = await command(['complete', '--job', job.job], { env });
  assert.equal(completed.exitCode, 0, completed.stdout);
  assert.equal(JSON.parse(completed.stdout).result.provider.type, 'native');
  await assert.rejects(readFile(job.promptFile));
  const abandoned = await command(['prepare', '--host', 'codex', '--request-file', '-'], { env, input: JSON.stringify(request) });
  const discarded = await command(['discard', '--job', JSON.parse(abandoned.stdout).result.job], { env });
  assert.equal(discarded.exitCode, 0, discarded.stdout);
  for (const args of [['prepare', '--request-file', '-'], ['complete'], ['discard'], ['prepare', '--host', 'codex', '--provider', 'mock']]) {
    assert.equal((await command(args, { env, input: JSON.stringify(request) })).exitCode, 2);
  }
});
