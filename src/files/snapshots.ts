import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fail, OffloadError } from '../core/errors.js';
import type { Limits, ReadRequest } from '../core/schema.js';
import { runProcess } from '../process/run.js';

export interface Snapshot {
  sourceId: string;
  path: string;
  sha256: string;
  bytes: number;
  text: string;
  lines: string[];
}

export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function assertAllowed(relative: string): void {
  const parts = relative.split(/[\\/]/).map(p => p.toLowerCase());
  const deniedDirectories = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.cache', '.next', '.ssh', '.aws', '.azure', '.gnupg', '.config', '.claude', '.codex', '.docker', '.kube', '.offload-local']);
  if (parts.some(p => deniedDirectories.has(p) || p === '.env' || p.startsWith('.env.') || /^(?:id_rsa|id_ed25519|credentials|secrets?)(?:\.|$)/.test(p) || /\.(?:pem|key|p12|pfx|keystore)$/.test(p))
    || parts.some(p => ['.npmrc', '.netrc', '.pypirc', '.git-credentials', '.offload.json'].includes(p))) {
    fail('PATH_DENIED', 'Selected path is excluded by the sensitive-file policy.');
  }
}

export async function readBoundedFile(file: string, maxBytes: number): Promise<Buffer> {
  try {
    const before = await stat(file);
    if (!before.isFile()) fail('FILE_UNSUPPORTED', 'Expected a regular file.');
    if (before.size > maxBytes) fail('BUDGET_EXCEEDED', 'Selected file exceeds its byte limit.');
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const initial = await handle.stat();
      if (!initial.isFile()) fail('FILE_UNSUPPORTED', 'Expected a regular file.');
      if (initial.ino !== before.ino || initial.dev !== before.dev) fail('SOURCE_CHANGED', 'File changed during snapshot capture.');
      const buffer = Buffer.alloc(maxBytes + 1);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > maxBytes) fail('BUDGET_EXCEEDED', 'Selected file exceeds its byte limit.');
      const after = await handle.stat();
      if (initial.size !== after.size || initial.mtimeMs !== after.mtimeMs || initial.ctimeMs !== after.ctimeMs || size !== after.size) fail('SOURCE_CHANGED', 'File changed during snapshot capture.');
      return buffer.subarray(0, size);
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof OffloadError) throw error;
    return fail('PATH_DENIED', 'Selected file is missing, unreadable, or changed during capture.');
  }
}

export function decodeText(bytes: Buffer): string {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return fail('FILE_UNSUPPORTED', 'Only valid UTF-8 text is supported.'); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) fail('FILE_UNSUPPORTED', 'Binary data or unsupported control characters detected.');
  if (/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----|\b(?:sk-ant-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{30,})/.test(text)) fail('PATH_DENIED', 'Potential secret detected in selected content.');
  return text;
}

export function sourceLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map(line => line.endsWith('\r') ? line.slice(0, -1) : line);
}

export async function workspaceRoot(explicit?: string, cwd = process.cwd()): Promise<string> {
  let root = explicit;
  if (!root) {
    const git = await runProcess({ executable: 'git', args: ['rev-parse', '--show-toplevel'], cwd });
    if (git.exitCode !== 0) fail('INVALID_REQUEST', 'Outside a Git worktree; supply --root explicitly.');
    root = git.stdout.trim();
  }
  try {
    const resolved = await realpath(path.resolve(cwd, root));
    if (!(await stat(resolved)).isDirectory()) fail('PATH_DENIED', 'Workspace root must be a directory.');
    return resolved;
  } catch { return fail('PATH_DENIED', 'Workspace root is unavailable.'); }
}

export async function capture(request: ReadRequest, limits: Limits): Promise<{ root: string; snapshots: Snapshot[] }> {
  const root = await workspaceRoot(request.root);
  if (request.paths.length > limits.maxFiles) fail('BUDGET_EXCEEDED', 'Too many selected files.');
  const seen = new Set<string>();
  const snapshots: Snapshot[] = [];
  let corpusBytes = 0;
  for (const requested of request.paths) {
    if (/[\u0000-\u001f*?\[\]{}]/.test(requested)) fail('INVALID_REQUEST', 'Supply explicit file paths without globs or control characters.');
    const absolute = path.resolve(root, requested);
    if (!isInside(root, absolute)) fail('PATH_DENIED', 'Selected path escapes the workspace.');
    assertAllowed(path.relative(root, absolute));
    let canonical: string;
    try { canonical = await realpath(absolute); } catch { return fail('PATH_DENIED', 'Selected file is missing or unreadable.'); }
    if (!isInside(root, canonical)) fail('PATH_DENIED', 'Selected symlink escapes the workspace.');
    assertAllowed(path.relative(root, canonical));
    if (seen.has(canonical)) fail('INVALID_REQUEST', 'Duplicate files are not allowed.');
    seen.add(canonical);
    const bytes = await readBoundedFile(canonical, limits.maxFileBytes);
    let afterPath: string;
    try { afterPath = await realpath(absolute); }
    catch { return fail('SOURCE_CHANGED', 'Selected path disappeared during capture.'); }
    if (afterPath !== canonical) fail('SOURCE_CHANGED', 'Selected path changed during capture.');
    corpusBytes += bytes.length;
    if (corpusBytes > limits.maxCorpusBytes) fail('BUDGET_EXCEEDED', 'Selected corpus exceeds its byte limit.');
    const text = decodeText(bytes);
    snapshots.push({ sourceId: `s${snapshots.length + 1}`, path: path.relative(root, absolute), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, text, lines: sourceLines(text) });
  }
  return { root, snapshots };
}

export function manifest(snapshots: Snapshot[]) {
  return snapshots.map(({ sourceId, path, sha256, bytes, lines }) => ({ sourceId, path, sha256, bytes, includedLineRanges: lines.length ? [[1, lines.length]] : [] }));
}
