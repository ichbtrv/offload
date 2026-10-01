import assert from 'node:assert/strict';
import test from 'node:test';
import { parseClaudeOutput, parseCodexOutput } from '../src/providers/response.js';
import { claudeArgs, authorizeCheck, probe } from '../src/providers/providers.js';
import { defaultConfig, profileHash } from '../src/config/config.js';
import { code } from './helpers.js';

const content = { answer: 'example' };

test('Claude parser extracts only final structured content and reported usage', () => {
  const result = parseClaudeOutput(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(content), usage: { input_tokens: 42, output_tokens: 8 } }));
  assert.deepEqual(result.content, content);
  assert.equal(result.usage.inputTokens, 42);
  assert.deepEqual(parseClaudeOutput(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: content })).content, content);
});

test('Claude rejects malformed, partial, exhausted and denied-tool results', () => {
  assert.throws(() => parseClaudeOutput('not json'), code('OUTPUT_INVALID'));
  for (const subtype of ['error_max_turns', 'error_during_execution', 'error_max_budget_usd']) {
    assert.throws(() => parseClaudeOutput(JSON.stringify({ type: 'result', subtype, is_error: false, result: '{}' })), code('OUTPUT_INVALID'));
  }
  assert.throws(() => parseClaudeOutput(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, permission_denials: [{}], result: '{}' })), code('WORKER_POLICY_UNSUPPORTED'));
  assert.throws(() => parseClaudeOutput(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'max_tokens', result: '{}' })), code('OUTPUT_INVALID'));
  assert.throws(() => parseClaudeOutput(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, modelUsage: { first: {}, fallback: {} }, result: '{}' })), code('MODEL_UNAVAILABLE'));
});

test('Codex parser ignores reasoning and requires one completed final answer', () => {
  const events = [
    { type: 'thread.started', thread_id: 'fixture' }, { type: 'turn.started' },
    { type: 'item.completed', item: { type: 'reasoning', text: 'not the answer' } },
    { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(content) } },
    { type: 'turn.completed', usage: { input_tokens: 4, output_tokens: 2 } },
  ];
  const serialize = (items: unknown[]) => items.map(item => JSON.stringify(item)).join('\n');
  assert.deepEqual(parseCodexOutput(serialize(events)).content, content);
  assert.throws(() => parseCodexOutput(serialize(events.slice(0, -1))), code('OUTPUT_INVALID'));
  assert.throws(() => parseCodexOutput(serialize([...events, { type: 'turn.started' }])), code('OUTPUT_INVALID'));
  assert.throws(() => parseCodexOutput(serialize([{ type: 'item.started', item: { type: 'command_execution' } }])), code('WORKER_POLICY_UNSUPPORTED'));
  assert.throws(() => parseCodexOutput('{bad json}\n'), code('OUTPUT_INVALID'));
  assert.throws(() => parseCodexOutput(serialize([{ type: 'turn.failed', error: 'secret' } ])), code('OUTPUT_INVALID'));
});

test('Claude invocation disables built-ins, customizations and MCP without approval bypass', () => {
  const args = claudeArgs('chosen-model');
  assert.equal(args[args.indexOf('--tools') + 1], '');
  for (const flag of ['--safe-mode', '--restricted', '--strict-mcp-config', '--no-session-persistence', '--no-chrome']) assert.ok(args.includes(flag));
  assert.equal(args.some(arg => /bypass|dangerous|resume|continue/.test(arg)), false);
  assert.equal(args.at(-1), 'chosen-model');
});

test('authorization identity binds executable, model and destination; mock stays offline', async () => {
  const config = defaultConfig('claude-cli');
  const hash = profileHash(config.provider);
  assert.notEqual(profileHash({ ...config.provider, model: 'different' }), hash);
  assert.notEqual(profileHash({ ...config.provider, executable: '/other/claude' }), hash);
  assert.notEqual(profileHash({ ...config.provider, destination: 'openai' }), hash);
  const mock = defaultConfig('mock');
  assert.equal((await probe(mock.provider)).policySupported, true);
  assert.equal((await authorizeCheck(mock)).authenticated, true);
});
