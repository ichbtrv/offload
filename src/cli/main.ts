#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { analyzeFiles, inspectRequest } from '../core/analyze.js';
import { exitCodes, fail, safeError } from '../core/errors.js';
import { parseJson, validate } from '../core/schema.js';
import { configPath, defaultConfig, loadConfig, profileHash, saveConfig } from '../config/config.js';
import { decodeText, readBoundedFile } from '../files/snapshots.js';
import { probe } from '../providers/providers.js';
import { integrate } from '../integrations/install.js';
import { prepareNative, completeNative, discardNative } from '../core/native.js';

const help = {
  name: 'offload', version: '0.1.0', phase: 'Portfolio MVP: bounded source analysis',
  commands: {
    integrate: 'offload integrate --root PROJECT [--remove] (native Codex and Claude instructions and pinned launcher)',
    prepare: 'offload prepare --host codex|claude --question QUESTION --paths FILE... [--root ROOT] [--request-file PATH|-]',
    complete: 'offload complete --job JOB (validate a native worker answer and remove its temporary packet)',
    discard: 'offload discard --job JOB (remove a stopped native worker job)',
    init: 'offload init --provider claude-cli --model MODEL --context-tokens 16000 [--authorize-remote] [--config PATH]',
    doctor: 'offload doctor [--provider claude-cli|codex-cli|mock] [--config PATH]',
    read: 'offload read (--question QUESTION --paths FILE... [--root ROOT] | --request-file PATH|-) [--dry-run] [--provider mock] [--config PATH]',
  },
  notes: [
    'Agent integrations use native subagents with inherited model selection and host permissions. No separate worker login or model setup is needed.',
    'Prepare/complete/discard are local operations; the host launches inference. Standalone read/init remain available separately.',
    'Every command accepts --json. JSON mode writes exactly one versioned envelope.',
    'Hosted init previews consent without writing until --authorize-remote is supplied. Existing configs are never overwritten.',
    'A live profile sends selected snapshots and the question to the chosen CLI provider and may consume account usage.',
    'Only --provider mock may override a read profile. No provider fallback, recursive workers, or retries.',
    'Generate/apply, hooks, cache, MCP, and Ollama belong to later phases and are not implemented.',
  ],
};

const valueOptions = new Set(['provider', 'model', 'context-tokens', 'config', 'executable', 'question', 'root', 'request-file', 'host', 'job']);
const boolOptions = new Set(['json', 'dry-run', 'authorize-remote', 'help', 'remove']);
interface Args { command: string; values: Map<string, string>; flags: Set<string>; paths: string[] }

function parseArgs(argv: string[]): Args {
  const command = argv[0]?.startsWith('--') ? 'help' : argv[0] ?? 'help';
  const tokens = command === 'help' && argv[0]?.startsWith('--') ? argv : argv.slice(1);
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!token.startsWith('--')) fail('INVALID_REQUEST', 'Unexpected positional argument. Use --help for usage.');
    const key = token.slice(2);
    if (flags.has(key) || values.has(key) || (key === 'paths' && paths.length)) fail('INVALID_REQUEST', 'Duplicate option.');
    if (boolOptions.has(key)) flags.add(key);
    else if (key === 'paths') {
      while (tokens[i + 1] && !tokens[i + 1]!.startsWith('--')) paths.push(tokens[++i]!);
      if (!paths.length) fail('INVALID_REQUEST', '--paths needs at least one explicit file path.');
    } else if (valueOptions.has(key)) {
      const value = tokens[++i];
      if (!value || value.startsWith('--')) fail('INVALID_REQUEST', 'Option requires a value.');
      values.set(key, value);
    } else fail('INVALID_REQUEST', 'Unknown option. Use --help for usage.');
  }
  const permitted: Record<string, string[]> = {
    help: ['json', 'help'],
    integrate: ['root', 'remove', 'json', 'help'],
    prepare: ['host', 'question', 'paths', 'root', 'request-file', 'json', 'help'],
    complete: ['job', 'json', 'help'],
    discard: ['job', 'json', 'help'],
    init: ['provider', 'model', 'context-tokens', 'config', 'executable', 'authorize-remote', 'json', 'help'],
    doctor: ['provider', 'config', 'json', 'help'],
    read: ['question', 'paths', 'root', 'request-file', 'dry-run', 'provider', 'config', 'json', 'help'],
  };
  if (!permitted[command]) fail('INVALID_REQUEST', 'Unknown or later-phase command. Use --help for supported commands.');
  if ([...values.keys(), ...flags, ...(paths.length ? ['paths'] : [])].some(k => !permitted[command]!.includes(k))) fail('INVALID_REQUEST', 'Option is not valid for this command.');
  return { command, values, flags, paths };
}

async function stdinRequest(): Promise<string> {
  if (process.stdin.isTTY) fail('INVALID_REQUEST', 'Pipe a JSON request to stdin.');
  const chunks: Buffer[] = [];
  let size = 0;
  const timer = setTimeout(() => process.stdin.destroy(new Error('Input timeout')), 10000);
  try {
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.length;
      if (size > 65536) fail('BUDGET_EXCEEDED', 'Request JSON exceeds 64 KiB.');
      chunks.push(buffer);
    }
    return decodeText(Buffer.concat(chunks));
  } catch (error) {
    if (size > 65536) throw error;
    return fail('INVALID_REQUEST', 'Could not read a complete JSON request from stdin within 10 seconds.');
  } finally { clearTimeout(timer); process.stdin.destroy(); }
}

async function main(args: Args, signal: AbortSignal): Promise<unknown> {
  if (args.command === 'help' || args.flags.has('help')) return help;
  if (process.env.OFFLOAD_WORKER === '1') fail('NESTED_INVOCATION_UNSUPPORTED', 'Offload workers cannot invoke Offload again.');
  if (args.command === 'integrate') {
    const root = args.values.get('root');
    if (!root) fail('INVALID_REQUEST', 'Choose an explicit project directory with --root.');
    return integrate(root, args.flags.has('remove'));
  }
  if (args.command === 'complete' || args.command === 'discard') {
    const job = args.values.get('job');
    if (!job) fail('INVALID_REQUEST', 'Supply --job from the prepare result.');
    return args.command === 'complete' ? completeNative(job) : discardNative(job);
  }
  if (args.command === 'prepare') return prepareNative(await readRequest(args), args.values.get('host'));
  const selected = args.values.get('provider');
  const provider = selected ? validate(z.enum(['mock', 'claude-cli', 'codex-cli']), selected) : undefined;
  const explicitConfig = args.values.get('config');
  if (args.command === 'init') {
    if (!provider) fail('INVALID_REQUEST', 'Choose --provider claude-cli, codex-cli, or mock.');
    const config = defaultConfig(provider);
    config.provider.executable = args.values.get('executable') ?? config.provider.executable;
    config.provider.model = args.values.get('model') ?? null;
    if (args.values.has('context-tokens')) config.limits.contextTokens = validate(z.number().int().min(4096).max(1000000), Number(args.values.get('context-tokens')));
    const status = await probe(config.provider);
    config.provider.executable = status.executable;
    const file = path.resolve(explicitConfig ?? configPath());
    if (provider !== 'mock' && !args.flags.has('authorize-remote')) return {
      saved: false, configPath: file, proposedConfig: config, status,
      consent: 'The selected CLI sends snapshots and your question to its hosted inference provider. This may consume subscription/API usage. Its provider retention policy applies. Existing login alone is not authorization.',
      nextStep: 'Choose an explicit --model and --context-tokens, then repeat with --authorize-remote to save consent for this exact profile.',
    };
    if (provider !== 'mock') {
      if (!status.policySupported) fail('WORKER_POLICY_UNSUPPORTED', status.reason);
      if (!config.provider.model || !args.values.has('context-tokens')) fail('INVALID_REQUEST', 'Hosted initialization requires --model and --context-tokens.');
      if (provider === 'claude-cli' && !/^claude-[a-zA-Z0-9.-]+$/.test(config.provider.model)) fail('INVALID_REQUEST', 'Use a full Claude model ID, not an alias such as sonnet or opus.');
      config.authorization = { profileHash: profileHash(config.provider), cliVersion: status.version };
    }
    await saveConfig(file, config);
    return { saved: true, configPath: file, provider: config.provider, status, warnings: status.authenticated ? [] : ['CLI login is required before a live read.'] };
  }
  const loaded = provider && (provider === 'mock' || args.command === 'doctor')
    ? { config: defaultConfig(provider), provenance: 'explicit provider selection' }
    : await loadConfig(explicitConfig);
  if (args.command === 'doctor') {
    const config = provider ? defaultConfig(provider) : loaded.config;
    const status = await probe(config.provider);
    const authorized = config.provider.type === 'mock' || (config.authorization?.profileHash === profileHash(config.provider) && config.authorization.cliVersion === status.version && config.provider.executable === status.executable);
    return {
      ready: status.policySupported && status.authenticated && authorized,
      status, authorized, provider: config.provider, limits: config.limits,
      provenance: provider ? 'explicit provider diagnostic (does not change configuration)' : loaded.provenance,
      repositoryConfig: 'Not loaded. Repository files cannot grant trust or change security ceilings.',
      warnings: ['No inference performed.', 'Doctor cannot guarantee model entitlement; a separately authorized live test is needed.'],
    };
  }
  if (provider && provider !== 'mock') fail('INVALID_REQUEST', 'Read uses its authorized configuration; only an explicit offline mock override is supported.');
  const request = await readRequest(args);
  return args.flags.has('dry-run') ? inspectRequest(request, loaded.config) : analyzeFiles(request, loaded.config, signal);
}

async function readRequest(args: Args): Promise<unknown> {
  const requestFile = args.values.get('request-file');
  if (requestFile && (args.paths.length || args.values.has('question') || args.values.has('root'))) fail('INVALID_REQUEST', 'Request-file JSON cannot be combined with question, paths, or root options.');
  return requestFile
    ? parseJson(requestFile === '-' ? await stdinRequest() : decodeText(await readBoundedFile(path.resolve(requestFile), 65536)))
    : { question: args.values.get('question'), paths: args.paths, ...(args.values.has('root') ? { root: args.values.get('root') } : {}) };
}

const requestId = randomUUID();
const json = process.argv.includes('--json');
const controller = new AbortController();
const cancel = () => controller.abort();
process.on('SIGINT', cancel);
process.on('SIGTERM', cancel);
try {
  if (Number(process.versions.node.split('.')[0]) < 22) fail('CLI_UNSUPPORTED', 'Offload requires Node.js 22 or newer; use the Node 24 LTS version in .nvmrc.');
  const result = await main(parseArgs(process.argv.slice(2)), controller.signal);
  const envelope = { ok: true, schemaVersion: 1, requestId, result };
  process.stdout.write(`${JSON.stringify(json ? envelope : result, null, json ? undefined : 2)}\n`);
} catch (error) {
  const safe = safeError(error);
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, schemaVersion: 1, requestId, error: { code: safe.code, message: safe.message } })}\n`);
  else process.stderr.write(`${safe.code}: ${safe.message}\n`);
  process.exitCode = exitCodes[safe.code];
} finally {
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', cancel);
}
