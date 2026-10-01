#!/usr/bin/env node
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const mode = process.env.OFFLOAD_FAKE_MODE ?? 'success';
if (args.includes('--version')) {
  console.log(mode === 'unsupported-version' ? '0.0.0 (Claude Code)' : '2.1.268 (Claude Code)');
} else if (args.includes('--help')) {
  console.log('--safe-mode --restricted --tools --strict-mcp-config --mcp-config --no-session-persistence --disable-slash-commands --disallowedTools --no-chrome');
} else if (args[0] === 'auth') {
  console.log(JSON.stringify({ loggedIn: mode !== 'no-login', apiProvider: 'firstParty', subscriptionType: 'max' }));
} else if (args[0] === 'login') {
  console.log('Logged in using fixture');
} else {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  if (process.env.OFFLOAD_FAKE_RECORD) writeFileSync(process.env.OFFLOAD_FAKE_RECORD, JSON.stringify({ args, input, cwd: process.cwd(), worker: process.env.OFFLOAD_WORKER }));
  if (mode === 'malformed') {
    console.log('{broken JSON');
  } else if (mode === 'nonzero') {
    console.error('private-secret-do-not-return');
    process.exitCode = 1;
  } else if (mode === 'oversized') {
    console.log('x'.repeat(200000));
  } else {
    const payload = JSON.parse(input);
    const source = payload.sources[0];
    const response = {
      answer: 'The comparison checks expiration.',
      findings: [{ sourceId: source.sourceId, startLine: 2, endLine: 2, quote: source.numberedLines[1].text, explanation: 'The comparison is on line two.' }],
      coverage: { status: 'complete', inspectedSourceIds: payload.sources.map(s => s.sourceId), omissions: [] },
      warnings: [], unresolvedQuestions: [],
    };
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(response), usage: { input_tokens: 100, output_tokens: 40 } }));
  }
}
