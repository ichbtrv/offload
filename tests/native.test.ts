import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { prepareNative, completeNative, discardNative } from '../src/core/native.js';
import { code, fixture } from './helpers.js';

const answer = {
  answer: 'Expiration is checked by comparing now with end.',
  findings: [{ sourceId: 's1', startLine: 2, endLine: 2, quote: 'return now >= end;', explanation: 'The comparison includes the end time.' }],
  coverage: { status: 'complete', inspectedSourceIds: ['s1'], omissions: [] },
  warnings: [], unresolvedQuestions: [],
};

test('native packets stay outside parent output, validate evidence, and clean up without a worker login', async t => {
  const { request } = await fixture(t);
  for (const host of ['codex', 'claude']) {
    const prepared = await prepareNative(request, host);
    t.after(() => rm(prepared.job, { recursive: true, force: true }));
    assert.equal(JSON.stringify(prepared).includes('return now >= end'), false);
    assert.equal(prepared.modelSelection, 'inherit');
    assert.equal(prepared.serializedInputBytes < 64000 - 4096 - 1200, true);
    assert.equal((await stat(prepared.job)).mode & 0o777, 0o700);
    assert.equal((await stat(prepared.promptFile)).mode & 0o777, 0o600);
    const packet = JSON.parse(await readFile(prepared.promptFile, 'utf8'));
    assert.equal(packet.sources.length, 1);
    assert.equal(packet.question, request.question);
    await writeFile(prepared.answerFile, JSON.stringify(answer));
    const result = await completeNative(prepared.job);
    assert.equal(result.findings[0]?.quote, answer.findings[0]?.quote);
    assert.equal(result.provider.host, host);
    assert.equal(result.provider.model, null);
    assert.equal(result.executionPolicy, 'host-permissions');
    assert.equal(result.usage.inputTokens, null);
    await assert.rejects(stat(prepared.job));
  }
});

test('native preparation uses a practical context budget without weakening explicit limits', async t => {
  const { root, request } = await fixture(t);
  const source = Array.from({ length: 300 }, (_, index) => `export const value${index} = ${index};`).join('\n');
  await writeFile(path.join(root, 'medium.ts'), `${source}\n`);
  const prepared = await prepareNative({ ...request, paths: ['medium.ts'] }, 'codex');
  t.after(() => rm(prepared.job, { recursive: true, force: true }));
  assert.ok(prepared.serializedInputBytes > 16000 - 4096 - 1200);
  await discardNative(prepared.job);
});

test('native completion rejects fabricated citations, stale sources, modified state or packets, and oversized answers', async t => {
  const { request, root } = await fixture(t);
  for (const mode of ['quote', 'source', 'packet', 'state-and-packet', 'size', 'symlink']) {
    const prepared = await prepareNative(request, 'codex');
    t.after(() => rm(prepared.job, { recursive: true, force: true }));
    await writeFile(prepared.answerFile, JSON.stringify(answer));
    const stateFile = path.join(prepared.job, 'state.json');
    const originalState = await readFile(stateFile, 'utf8');
    let expected = 'OUTPUT_INVALID' as 'OUTPUT_INVALID' | 'SOURCE_CHANGED' | 'BUDGET_EXCEEDED' | 'PATH_DENIED';
    if (mode === 'quote') await writeFile(prepared.answerFile, JSON.stringify({ ...answer, findings: [{ ...answer.findings[0], quote: 'invented quote' }] }));
    if (mode === 'source') { await writeFile(path.join(root, 'session.ts'), 'changed\n'); expected = 'SOURCE_CHANGED'; }
    if (mode === 'packet') { await writeFile(prepared.promptFile, '{}'); expected = 'SOURCE_CHANGED'; }
    if (mode === 'state-and-packet') {
      const replacement = '{}';
      const state = JSON.parse(originalState);
      state.promptHash = createHash('sha256').update(replacement).digest('hex');
      await writeFile(prepared.promptFile, replacement);
      await writeFile(stateFile, JSON.stringify(state));
      expected = 'SOURCE_CHANGED';
    }
    if (mode === 'size') { await writeFile(prepared.answerFile, 'x'.repeat(17000)); expected = 'BUDGET_EXCEEDED'; }
    if (mode === 'symlink') {
      await rm(prepared.answerFile);
      await symlink(path.join(root, 'session.ts'), prepared.answerFile);
      expected = 'PATH_DENIED';
    }
    await assert.rejects(completeNative(prepared.job), code(expected));
    if (mode === 'state-and-packet') await writeFile(stateFile, originalState);
    await discardNative(prepared.job);
    await assert.rejects(stat(prepared.job));
  }
});

test('native preparation enforces path and context limits and cleanup refuses unrelated directories/files', async t => {
  const { request, root, config } = await fixture(t);
  await assert.rejects(prepareNative(request, 'unknown'), code('INVALID_REQUEST'));
  await assert.rejects(prepareNative({ ...request, paths: ['.env'] }, 'codex'), code('PATH_DENIED'));
  await assert.rejects(prepareNative(request, 'codex', { ...config.limits, contextTokens: 4096 }), code('BUDGET_EXCEEDED'));
  await assert.rejects(discardNative(root), code('PATH_DENIED'));
  const prepared = await prepareNative(request, 'codex');
  t.after(() => rm(prepared.job, { recursive: true, force: true }));
  await writeFile(path.join(prepared.job, 'unrelated.txt'), 'keep');
  await assert.rejects(discardNative(prepared.job), code('TARGET_CONFLICT'));
  assert.ok(await readFile(prepared.promptFile));
});
