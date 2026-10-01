import { spawn } from 'node:child_process';
import { fail, OffloadError } from '../core/errors.js';

export interface RunOptions {
  executable: string;
  args: string[];
  cwd: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  maxErrorBytes?: number;
  signal?: AbortSignal;
}

export interface ProcessResult { stdout: string; stderr: string; exitCode: number }

// POSIX process groups also catch CLI-spawned children after the leader exits.
export async function runProcess(options: RunOptions): Promise<ProcessResult> {
  if (process.platform === 'win32') fail('CLI_UNSUPPORTED', 'Worker process lifecycle currently supports macOS and Linux.');
  if (options.signal?.aborted) fail('CANCELLED', 'Operation cancelled.');
  if (Buffer.byteLength(options.input ?? '') > (options.maxInputBytes ?? 1048576)) fail('BUDGET_EXCEEDED', 'Serialized worker input exceeds its byte limit.');
  return new Promise((resolve, reject) => {
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd, env: options.env ?? process.env,
      shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let failure: OffloadError | undefined;
    const killGroup = () => {
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
      }
    };
    const stop = (error: OffloadError) => { failure ??= error; killGroup(); };
    const cancel = () => stop(new OffloadError('CANCELLED', 'Operation cancelled.'));
    const timer = setTimeout(() => stop(new OffloadError('TIMEOUT', 'Worker exceeded its time limit.')), options.timeoutMs ?? 10000);
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > (options.maxOutputBytes ?? 1048576)) stop(new OffloadError('OUTPUT_TRUNCATED', 'Worker output exceeded its byte limit.'));
      else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errBytes += chunk.length;
      if (errBytes > (options.maxErrorBytes ?? 65536)) stop(new OffloadError('OUTPUT_TRUNCATED', 'Worker diagnostics exceeded their byte limit.'));
      else stderr.push(chunk);
    });
    child.stdin.on('error', () => { /* EPIPE is reflected by child completion. */ });
    child.on('error', () => { failure ??= new OffloadError('PROVIDER_UNAVAILABLE', 'Could not launch the configured executable.'); });
    child.on('exit', killGroup);
    child.on('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
      killGroup();
      if (failure) reject(failure);
      else {
        try {
          const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(stdout));
          resolve({ stdout: decoded, stderr: Buffer.concat(stderr).toString('utf8'), exitCode: code ?? 1 });
        } catch { reject(new OffloadError('OUTPUT_INVALID', 'Worker stdout is not valid UTF-8.')); }
      }
    });
    child.stdin.end(options.input ?? '');
  });
}
