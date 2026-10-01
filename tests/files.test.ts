import assert from 'node:assert/strict';
import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { capture, decodeText, isInside, workspaceRoot } from '../src/files/snapshots.js';
import { code, fixture } from './helpers.js';

test('snapshots preserve bytes, Unicode paths, CRLF line identity, and SHA-256', async t => {
  const { root, request, config } = await fixture(t);
  const content = '\ufeffconst café = 1;\r\n// second line\r\n';
  await writeFile(path.join(root, 'a space é.ts'), content);
  const result = await capture({ ...request, paths: ['a space é.ts'] }, config.limits);
  assert.equal(result.snapshots[0]?.text, content);
  assert.deepEqual(result.snapshots[0]?.lines, ['\ufeffconst café = 1;', '// second line']);
  assert.equal(result.snapshots[0]?.sha256, createHash('sha256').update(content).digest('hex'));
});

test('canonical containment rejects traversal, sibling prefixes, and escaping symlinks', async t => {
  const { root, request, config } = await fixture(t);
  assert.equal(isInside(root, `${root}-sibling/file.ts`), false);
  await assert.rejects(capture({ ...request, paths: ['../outside.ts'] }, config.limits), code('PATH_DENIED'));
  await symlink('/etc/hosts', path.join(root, 'escape.ts'));
  await assert.rejects(capture({ ...request, paths: ['escape.ts'] }, config.limits), code('PATH_DENIED'));
});

test('explicit selections cannot bypass default exclusions, including aliases', async t => {
  const { root, request, config } = await fixture(t);
  for (const file of ['.env', '.env.example', 'id_rsa', 'credentials.json', 'private.key', '.npmrc']) {
    await writeFile(path.join(root, file), 'sensitive');
    await assert.rejects(capture({ ...request, paths: [file] }, config.limits), code('PATH_DENIED'));
  }
  await symlink(path.join(root, '.env'), path.join(root, 'alias.ts'));
  await assert.rejects(capture({ ...request, paths: ['alias.ts'] }, config.limits), code('PATH_DENIED'));
  await mkdir(path.join(root, 'node_modules'));
  await writeFile(path.join(root, 'node_modules/a.ts'), 'x');
  await assert.rejects(capture({ ...request, paths: ['node_modules/a.ts'] }, config.limits), code('PATH_DENIED'));
});

test('missing files, directories, globs, duplicates, and binary encodings fail explicitly', async t => {
  const { root, request, config } = await fixture(t);
  await mkdir(path.join(root, 'folder'));
  await assert.rejects(capture({ ...request, paths: ['folder'] }, config.limits), code('FILE_UNSUPPORTED'));
  await assert.rejects(capture({ ...request, paths: ['missing.ts'] }, config.limits), code('PATH_DENIED'));
  await assert.rejects(capture({ ...request, paths: ['*.ts'] }, config.limits), code('INVALID_REQUEST'));
  await assert.rejects(capture({ ...request, paths: ['session.ts', './session.ts'] }, config.limits), code('INVALID_REQUEST'));
  assert.throws(() => decodeText(Buffer.from([0xff, 0xfe])), code('FILE_UNSUPPORTED'));
  assert.throws(() => decodeText(Buffer.from('hello\0world')), code('FILE_UNSUPPORTED'));
  assert.throws(() => decodeText(Buffer.from('-----BEGIN RSA PRIVATE KEY-----')), code('PATH_DENIED'));
});

test('file, corpus, and count budgets reject without truncation', async t => {
  const { root, request, config } = await fixture(t);
  await assert.rejects(capture(request, { ...config.limits, maxFileBytes: 4 }), code('BUDGET_EXCEEDED'));
  await assert.rejects(capture(request, { ...config.limits, maxCorpusBytes: 4 }), code('BUDGET_EXCEEDED'));
  await writeFile(path.join(root, 'other.ts'), 'other');
  await assert.rejects(capture({ ...request, paths: ['session.ts', 'other.ts'] }, { ...config.limits, maxFiles: 1 }), code('BUDGET_EXCEEDED'));
});

test('non-Git folders require an explicit workspace root', async t => {
  const { root } = await fixture(t);
  await assert.rejects(workspaceRoot(undefined, root), code('INVALID_REQUEST'));
  assert.equal(await workspaceRoot(root), await realpath(root));
});
