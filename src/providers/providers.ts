import { access, mkdtemp, mkdir, realpath, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { fail, OffloadError } from '../core/errors.js';
import { parseJson, type Config, type Profile } from '../core/schema.js';
import { profileHash } from '../config/config.js';
import { runProcess } from '../process/run.js';
import type { Snapshot } from '../files/snapshots.js';
import { parseClaudeOutput, type ProviderOutput } from './response.js';

const supportedClaudeVersions = new Set(['2.1.268 (Claude Code)', '2.1.278 (Claude Code)']);
const requiredFlags = ['--safe-mode', '--restricted', '--tools', '--strict-mcp-config', '--mcp-config', '--no-session-persistence', '--disable-slash-commands', '--disallowedTools', '--no-chrome'];
const managedPaths = [
  path.join(os.homedir(), '.claude', 'remote-settings.json'),
  ...(process.platform === 'darwin'
    ? ['/Library/Application Support/ClaudeCode', '/Library/Managed Preferences/com.anthropic.claudecode.plist', '/Library/Preferences/com.anthropic.claudecode.plist',
      path.join('/Library/Managed Preferences', os.userInfo().username, 'com.anthropic.claudecode.plist'),
      path.join(os.homedir(), 'Library/Preferences/com.anthropic.claudecode.plist')]
    : ['/etc/claude-code']),
];

export interface Probe {
  executable: string;
  version: string;
  authenticated: boolean;
  policySupported: boolean;
  reason: string;
}

export async function resolveExecutable(executable: string): Promise<string> {
  const candidates = path.isAbsolute(executable) ? [executable] : (process.env.PATH ?? '').split(path.delimiter).map(dir => path.resolve(dir, executable));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return await realpath(candidate);
    } catch { /* Try the next PATH entry. */ }
  }
  return fail('PROVIDER_UNAVAILABLE', 'Configured CLI is unavailable; install it or set an absolute trusted executable path.');
}

export function claudeArgs(model: string): string[] {
  return ['-p', '--output-format', 'json', '--safe-mode', '--restricted', '--tools', '',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disallowedTools', 'mcp__*',
    '--disable-slash-commands', '--no-session-persistence', '--no-chrome', '--model', model];
}

function assertEnvironment(profile: Profile): void {
  if (process.env.OFFLOAD_WORKER === '1') fail('NESTED_INVOCATION_UNSUPPORTED', 'Offload cannot launch from an Offload worker.');
  if (profile.type === 'claude-cli' && process.env.CLAUDECODE) fail('NESTED_INVOCATION_UNSUPPORTED', 'Claude forbids this nested session; use an independent terminal. Host markers are preserved.');
  const redirects = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_PROFILE', 'ANTHROPIC_CONFIG_DIR', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'CLAUDE_CODE_CLIENT_CERT', 'CLAUDE_CODE_CLIENT_KEY', 'DYLD_INSERT_LIBRARIES', 'LD_PRELOAD'];
  if (profile.type === 'claude-cli' && redirects.some(key => Boolean(process.env[key]) || Boolean(process.env[key.toLowerCase()]))) fail('WORKER_POLICY_UNSUPPORTED', 'Custom authentication, routing, proxy, or runtime injection environment requires a separately verified worker profile.');
}

export async function probe(profile: Profile, signal?: AbortSignal): Promise<Probe> {
  if (profile.type === 'mock') return { executable: 'mock', version: 'mock-v1', authenticated: true, policySupported: true, reason: 'Offline deterministic fixture provider; no model inference.' };
  const executable = await resolveExecutable(profile.executable);
  const job = await mkdtemp(path.join(os.tmpdir(), 'offload-probe-'));
  try {
    const options = { executable, cwd: job, ...(signal ? { signal } : {}) };
    const version = await runProcess({ ...options, args: ['--version'] });
    if (version.exitCode !== 0) fail('CLI_UNSUPPORTED', 'CLI version detection failed.');
    const versionText = version.stdout.trim();
    if (profile.type === 'codex-cli') {
      const auth = await runProcess({ ...options, args: ['login', 'status'] });
      return { executable, version: versionText, authenticated: auth.exitCode === 0, policySupported: false, reason: 'No verified way to disable every Codex tool, hook, plugin and incidental file read. Read-only sandboxing is insufficient; Codex inference is disabled.' };
    }
    const help = await runProcess({ ...options, args: ['--help'] });
    let policySupported = supportedClaudeVersions.has(versionText) && help.exitCode === 0 && requiredFlags.every(flag => help.stdout.includes(flag));
    let reason = policySupported ? 'Documented restriction flags are available on an inspected CLI version. Live isolation smoke test is still required.' : `Inspected Claude versions: ${[...supportedClaudeVersions].join(', ')}; required restriction flags must be present.`;
    for (const location of managedPaths) {
      try {
        await access(location);
        policySupported = false;
        reason = 'Managed Claude configuration is present; its policy hooks require separate verification. Offload will not override organizational policy.';
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
          policySupported = false;
          reason = 'Could not verify managed Claude configuration.';
        }
      }
    }
    const auth = await runProcess({ ...options, args: ['auth', 'status'] });
    const parsed = z.object({ loggedIn: z.boolean(), apiProvider: z.string().optional(), subscriptionType: z.string().optional() }).passthrough().safeParse(parseJson(auth.stdout, 'OUTPUT_INVALID'));
    const authenticated = auth.exitCode === 0 && parsed.success && parsed.data.loggedIn && parsed.data.apiProvider === 'firstParty';
    if (authenticated && !['pro', 'max'].includes(parsed.data.subscriptionType ?? '')) {
      policySupported = false;
      reason = 'Only identifiable personal Pro/Max logins are supported. Team, Enterprise, and unknown account types may load server-managed hooks and require separate policy verification.';
    }
    try { assertEnvironment(profile); }
    catch (error) {
      if (!(error instanceof OffloadError)) throw error;
      policySupported = false;
      reason = error.message;
    }
    return { executable, version: versionText, authenticated, policySupported, reason };
  } finally { await rm(job, { recursive: true, force: true }); }
}

export async function authorizeCheck(config: Config, signal?: AbortSignal): Promise<Probe> {
  assertEnvironment(config.provider);
  const status = await probe(config.provider, signal);
  if (!status.policySupported) fail('WORKER_POLICY_UNSUPPORTED', status.reason);
  if (config.provider.type === 'mock') return status;
  if (!config.provider.model || !/^claude-[a-zA-Z0-9.-]+$/.test(config.provider.model)) fail('MODEL_UNAVAILABLE', 'Set an explicit full Claude model ID when initializing the worker profile; model aliases are unsupported.');
  const expected = profileHash(config.provider);
  if (!config.authorization || config.authorization.profileHash !== expected || config.authorization.cliVersion !== status.version || config.provider.executable !== status.executable || config.provider.destination !== 'anthropic') fail('REMOTE_NOT_AUTHORIZED', 'Authorize this exact executable, CLI version, model, and destination with init --authorize-remote.');
  if (!status.authenticated) fail('AUTH_REQUIRED', 'Claude login was not detected. Run claude auth login in your own terminal, then retry.');
  return status;
}

export function mockOutput(snapshots: Snapshot[]): ProviderOutput {
  return {
    content: {
      answer: 'Offline mock: selected snapshots were captured and their first nonempty lines are cited. No semantic model analysis was performed.',
      findings: snapshots.flatMap(s => {
        const index = s.lines.findIndex(line => line.trim());
        return index === -1 ? [] : [{ sourceId: s.sourceId, startLine: index + 1, endLine: index + 1, quote: (s.lines[index] ?? '').slice(0, 300), explanation: 'Deterministic snapshot evidence; review the original source to answer your question.' }];
      }),
      coverage: { status: 'complete', inspectedSourceIds: snapshots.map(s => s.sourceId), omissions: [] },
      warnings: ['Mock output is not an AI answer.'], unresolvedQuestions: [],
    },
    usage: { inputTokens: null, outputTokens: null }, model: null,
  };
}

async function invokeWithinDeadline(config: Config, prompt: string, snapshots: Snapshot[], signal: AbortSignal): Promise<ProviderOutput & { version: string }> {
  const status = await authorizeCheck(config, signal);
  if (signal?.aborted) fail('CANCELLED', 'Operation cancelled.');
  if (config.provider.type === 'mock') return { ...mockOutput(snapshots), version: status.version };
  // authorizeCheck rejects Codex until its execution policy can be enforced.
  const lock = path.join(os.tmpdir(), `offload-worker-${process.getuid?.() ?? 'user'}.lock`);
  try { await mkdir(lock, { mode: 0o700 }); }
  catch { return fail('BUSY', 'Another worker holds the per-user lock. If a previous wrapper was killed, remove its stale lock only after confirming no worker is running.'); }
  let job: string | undefined;
  try {
    job = await mkdtemp(path.join(os.tmpdir(), 'offload-job-'));
    const result = await runProcess({
      executable: status.executable, args: claudeArgs(config.provider.model!), cwd: job, input: prompt,
      env: { ...process.env, OFFLOAD_WORKER: '1' },
      timeoutMs: config.limits.timeoutSeconds * 1000, maxOutputBytes: config.limits.maxResultBytes + 65536,
      ...(signal ? { signal } : {}),
    });
    if (result.exitCode !== 0) {
      // Classify without returning provider text, which may echo source/secrets.
      const diagnostic = `${result.stdout}\n${result.stderr}`;
      if (/not logged in|authentication|unauthorized|login required/i.test(diagnostic)) fail('AUTH_REQUIRED', 'Worker authentication failed.');
      if (/model.{0,30}(?:not found|unavailable|invalid)/i.test(diagnostic)) fail('MODEL_UNAVAILABLE', 'Configured model is unavailable.');
      throw new OffloadError('PROVIDER_UNAVAILABLE', 'Worker exited unsuccessfully; no fallback or retry was attempted.');
    }
    const parsed = parseClaudeOutput(result.stdout);
    if (parsed.model && parsed.model !== config.provider.model) fail('MODEL_UNAVAILABLE', 'Worker reported a different model than the authorized profile.');
    return { ...parsed, version: status.version };
  } finally {
    if (job) await rm(job, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

export async function invoke(config: Config, prompt: string, snapshots: Snapshot[], signal?: AbortSignal): Promise<ProviderOutput & { version: string }> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), config.limits.timeoutSeconds * 1000);
  const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  try { return await invokeWithinDeadline(config, prompt, snapshots, combined); }
  catch (error) {
    if (signal?.aborted) fail('CANCELLED', 'Operation cancelled.');
    if (deadline.signal.aborted) fail('TIMEOUT', 'Worker and preflight exceeded their total time limit.');
    throw error;
  } finally { clearTimeout(timer); }
}
