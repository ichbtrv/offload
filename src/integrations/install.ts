import { lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from '../core/errors.js';
import { claudeReader, nativeInstructions } from './native-instructions.js';

const start = '<!-- offload:begin -->';
const end = '<!-- offload:end -->';
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const absent = (error: unknown) => error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';

async function readRegular(file: string): Promise<string | undefined> {
  try {
    if (!(await lstat(file)).isFile()) fail('TARGET_CONFLICT', 'Integration targets must be regular files, not symlinks.');
    return await readFile(file, 'utf8');
  } catch (error) { if (absent(error)) return undefined; throw error; }
}

function updateInstructions(existing: string, block: string, remove: boolean): string {
  const begin = existing.indexOf(start);
  const finish = existing.indexOf(end);
  if ((begin === -1) !== (finish === -1) || (begin !== -1 && (finish < begin || existing.indexOf(start, begin + start.length) !== -1 || existing.indexOf(end, finish + end.length) !== -1))) {
    fail('TARGET_CONFLICT', 'Offload instruction markers are malformed; resolve them before installing or removing.');
  }
  if (begin !== -1) return existing.slice(0, begin) + (remove ? '' : block) + existing.slice(finish + end.length);
  if (remove) return existing;
  if (existing && !existing.endsWith('\n')) fail('TARGET_CONFLICT', 'Existing instructions must end with a newline before appending an integration block.');
  return existing + block;
}

/** Explicit project installation only; never touches global agent settings or worker consent. */
export async function integrate(root: string, remove = false) {
  const directory = await realpath(root);
  if (!(await lstat(directory)).isDirectory()) fail('INVALID_REQUEST', 'Integration root must be a directory.');
  const directories = ['.offload-local', '.claude', '.claude/agents'].map(name => path.join(directory, name));
  for (const target of directories) {
    try {
      if (!(await lstat(target)).isDirectory()) fail('TARGET_CONFLICT', 'Integration directories must not be symlinks or files.');
    } catch (error) { if (!absent(error)) throw error; }
  }
  const launcher = path.join(directory, '.offload-local/offload');
  const entry = fileURLToPath(new URL('../cli/main.js', import.meta.url));
  const script = `#!/bin/sh\n# Offload project launcher v1\nexec ${quote(process.execPath)} ${quote(entry)} "$@"\n`;
  const owned = [
    { file: launcher, content: script, mode: 0o700 },
    { file: path.join(directory, '.claude/agents/offload-reader.md'), content: claudeReader, mode: 0o600 },
  ];
  // Preflight every target before changing anything, including when removing.
  const ownedPlans = [];
  for (const target of owned) {
    const original = await readRegular(target.file);
    if (original !== undefined && original !== target.content) fail('TARGET_CONFLICT', 'An integration-owned file differs from this installation; preserve it and resolve the conflict manually.');
    ownedPlans.push({ ...target, original });
  }
  const instructionPlans = [];
  for (const [name, host] of [['AGENTS.md', 'codex'], ['CLAUDE.md', 'claude']] as const) {
    const file = path.join(directory, name);
    const original = await readRegular(file);
    instructionPlans.push({ file, original, next: updateInstructions(original ?? '', nativeInstructions(host), remove) });
  }
  if (!remove) {
    for (const target of directories) await mkdir(target, { recursive: true, mode: 0o700 });
    for (const target of ownedPlans) {
      if (target.original === undefined) await writeFile(target.file, target.content, { flag: 'wx', mode: target.mode });
    }
  }
  for (const target of instructionPlans) {
    if (target.next === (target.original ?? '')) continue;
    if (remove && target.next === '') await unlink(target.file);
    else await writeFile(target.file, target.next, { flag: target.original === undefined ? 'wx' : 'w' });
  }
  if (remove) for (const target of ownedPlans) if (target.original !== undefined) await unlink(target.file);
  return { installed: !remove, root: directory, instructions: instructionPlans.map(p => p.file), launcher,
    claudeAgent: owned[1]!.file, runtime: process.execPath, mode: 'native', modelSelection: 'inherit',
    notes: ['Native workers use the current host session; no separate login, worker authorization, or global settings changed.',
      'Keep .offload-local/ out of version control; its launcher contains machine-local paths.',
      'Start a fresh Codex or Claude session to discover the installed instructions. Native workers follow host permissions.'] };
}
