import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { runProcess } from '../src/process/run.js';
import { code, fixture } from './helpers.js';

test('transport sends data on stdin, separates diagnostics, and preserves argument boundaries', async t => {
  const { root } = await fixture(t);
  const script = 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{console.error("diagnostic");console.log(JSON.stringify({stdin:s,args:process.argv.slice(1)}))})';
  const result = await runProcess({ executable: process.execPath, args: ['-e', script, 'literal; $(touch unsafe)'], cwd: root, input: 'private source payload' });
  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /diagnostic/);
  assert.deepEqual(JSON.parse(result.stdout), { stdin: 'private source payload', args: ['literal; $(touch unsafe)'] });
});

test('timeout, cancellation, missing executables, and all transport byte limits', async t => {
  const { root } = await fixture(t);
  const base = { executable: process.execPath, cwd: root };
  await assert.rejects(runProcess({ ...base, args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 50 }), code('TIMEOUT'));
  await assert.rejects(runProcess({ ...base, args: [], signal: AbortSignal.abort() }), code('CANCELLED'));
  await assert.rejects(runProcess({ ...base, executable: '/offload-missing-cli', args: [] }), code('PROVIDER_UNAVAILABLE'));
  await assert.rejects(runProcess({ ...base, args: [], input: 'oversized', maxInputBytes: 2 }), code('BUDGET_EXCEEDED'));
  await assert.rejects(runProcess({ ...base, args: ['-e', 'process.stdout.write("x".repeat(10000))'], maxOutputBytes: 50 }), code('OUTPUT_TRUNCATED'));
  await assert.rejects(runProcess({ ...base, args: ['-e', 'process.stderr.write("secret".repeat(10000))'], maxErrorBytes: 50 }), code('OUTPUT_TRUNCATED'));
  await assert.rejects(runProcess({ ...base, args: ['-e', 'process.stdout.write(Buffer.from([255,254]))'] }), code('OUTPUT_INVALID'));
  const controller = new AbortController();
  const pending = runProcess({ ...base, args: ['-e', 'setInterval(()=>{},1000)'], signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, code('CANCELLED'));
});

test('timeout kills subprocess descendants, including children holding inherited pipes', async t => {
  const { root } = await fixture(t);
  const pidFile = path.join(root, 'descendant.pid');
  const script = `const {spawn}=require('node:child_process'); const fs=require('node:fs'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}); fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid)); setInterval(()=>{},1000);`;
  await assert.rejects(runProcess({ executable: process.execPath, args: ['-e', script], cwd: root, timeoutMs: 500 }), code('TIMEOUT'));
  const pid = Number(await readFile(pidFile, 'utf8'));
  // Reaping may lag group termination slightly; bounded retries inspect liveness.
  for (let attempt = 0; attempt < 20; attempt++) {
    try { process.kill(pid, 0); } catch { return; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('Worker descendant survived process-group termination');
});
