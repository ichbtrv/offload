import assert from 'node:assert/strict';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { integrate } from '../src/integrations/install.js';
import { runProcess } from '../src/process/run.js';
import { code, fixture } from './helpers.js';

test('project integration preserves instructions, is repeatable, runs outside checkout with no Node on PATH, and removes cleanly', async t => {
  const { root } = await fixture(t);
  const project = path.join(root, "project with ' quotes");
  await mkdir(project);
  const instructions = path.join(project, 'AGENTS.md');
  const original = '# Existing instructions\n\nKeep these exactly.\n';
  await writeFile(instructions, original);
  const claudeInstructions = path.join(project, 'CLAUDE.md');
  await writeFile(claudeInstructions, original);
  const installed = await integrate(project);
  const first = await readFile(instructions, 'utf8');
  assert.ok(first.startsWith(original));
  assert.ok(first.includes('--host codex'));
  assert.ok((await readFile(claudeInstructions, 'utf8')).includes('--host claude'));
  assert.ok((await readFile(installed.claudeAgent, 'utf8')).includes('model: inherit'));
  await integrate(project);
  assert.equal(await readFile(instructions, 'utf8'), first);
  for (const args of [
    ['--help', '--json'],
    ['doctor', '--provider', 'mock', '--json'],
    ['read', '--provider', 'mock', '--root', root, '--paths', 'session.ts', '--question', 'Where is expiration checked?', '--dry-run', '--json'],
  ]) {
    const result = await runProcess({ executable: installed.launcher, args, cwd: project, env: { ...process.env, PATH: '/usr/bin:/bin' } });
    assert.equal(result.exitCode, 0, result.stdout);
    assert.equal(JSON.parse(result.stdout).ok, true);
  }
  await integrate(project, true);
  assert.equal(await readFile(instructions, 'utf8'), original);
  assert.equal(await readFile(claudeInstructions, 'utf8'), original);
  await assert.rejects(readFile(installed.claudeAgent));
  await assert.rejects(readFile(installed.launcher));
  await integrate(project, true);
});

test('integration refuses symlinks, unmanaged launchers, and broken markers without changing instructions', async t => {
  const { root } = await fixture(t);
  const instructions = path.join(root, 'AGENTS.md');
  await symlink(path.join(root, 'session.ts'), instructions);
  await assert.rejects(integrate(root), code('TARGET_CONFLICT'));
  const other = path.join(root, 'other');
  await mkdir(other);
  await writeFile(path.join(other, 'AGENTS.md'), '<!-- offload:begin -->\n');
  await assert.rejects(integrate(other), code('TARGET_CONFLICT'));
  await writeFile(path.join(other, 'AGENTS.md'), 'Keep me\n');
  await mkdir(path.join(other, '.offload-local'));
  await writeFile(path.join(other, '.offload-local/offload'), '# custom launcher\n');
  for (const remove of [false, true]) await assert.rejects(integrate(other, remove), code('TARGET_CONFLICT'));
  assert.equal(await readFile(path.join(other, 'AGENTS.md'), 'utf8'), 'Keep me\n');
  const linked = path.join(root, 'linked');
  await mkdir(linked);
  await symlink(other, path.join(linked, '.offload-local'));
  await assert.rejects(integrate(linked), code('TARGET_CONFLICT'));
});

test('integration removes an instruction file it created', async t => {
  const { root } = await fixture(t);
  await integrate(root);
  await integrate(root, true);
  await assert.rejects(readFile(path.join(root, 'AGENTS.md')));
  await assert.rejects(readFile(path.join(root, 'CLAUDE.md')));
});

test('Claude integration conflicts are detected before changing Codex instructions or creating a launcher', async t => {
  const { root } = await fixture(t);
  await writeFile(path.join(root, 'AGENTS.md'), '# Keep\n');
  await writeFile(path.join(root, 'CLAUDE.md'), '<!-- offload:end -->');
  await assert.rejects(integrate(root), code('TARGET_CONFLICT'));
  assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), '# Keep\n');
  await assert.rejects(readFile(path.join(root, '.offload-local/offload')));
});
