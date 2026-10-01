import { answerSchema, configSchema, requestSchema, validate, type Config, type Answer } from './schema.js';
import { fail } from './errors.js';
import { capture, manifest, type Snapshot } from '../files/snapshots.js';
import { buildPrompt, promptVersion } from '../prompts/read.js';
import { invoke } from '../providers/providers.js';

export function validateEvidence(content: unknown, snapshots: Snapshot[]): Answer {
  const answer = validate(answerSchema, content, 'OUTPUT_INVALID');
  const sources = new Map(snapshots.map(s => [s.sourceId, s]));
  for (const finding of answer.findings) {
    const source = sources.get(finding.sourceId);
    if (!source || finding.startLine > finding.endLine || finding.endLine > source.lines.length) fail('OUTPUT_INVALID', 'Worker cited an unknown source or invalid line range.');
    if (finding.quote !== null && (!finding.quote || !source.lines.slice(finding.startLine - 1, finding.endLine).join('\n').includes(finding.quote))) fail('OUTPUT_INVALID', 'Worker quote does not match the cited source range.');
  }
  const covered = new Set<string>();
  const inspected = new Set(answer.coverage.inspectedSourceIds);
  for (const id of [...answer.coverage.inspectedSourceIds, ...answer.coverage.omissions.map(o => o.sourceId)]) {
    if (!sources.has(id) || covered.has(id)) fail('OUTPUT_INVALID', 'Worker coverage contains unknown or duplicate source IDs.');
    covered.add(id);
  }
  if (covered.size !== sources.size || (answer.coverage.status === 'complete' && answer.coverage.omissions.length > 0) || answer.findings.some(f => !inspected.has(f.sourceId))) fail('OUTPUT_INVALID', 'Worker coverage does not account consistently for every selected source.');
  return answer;
}

async function prepare(requestInput: unknown, configInput: Config) {
  const request = validate(requestSchema, requestInput);
  const config = validate(configSchema, configInput);
  const { root, snapshots } = await capture(request, config.limits);
  const prompt = buildPrompt(request, snapshots, config.limits);
  return { root, snapshots, prompt, config };
}

export async function inspectRequest(request: unknown, config: Config) {
  const prepared = await prepare(request, config);
  return {
    dryRun: true, root: prepared.root, sources: manifest(prepared.snapshots),
    sourceBytes: prepared.snapshots.reduce((sum, s) => sum + s.bytes, 0),
    serializedInputBytes: Buffer.byteLength(prepared.prompt),
    conservativeEstimatedInputTokens: Buffer.byteLength(prepared.prompt),
    cliContextReserveTokens: 4096, limits: prepared.config.limits,
    provider: prepared.config.provider,
    warnings: ['Dry-run reads selected files locally but sends no inference request.', 'Secret detection and context estimates are best effort.'],
  };
}

let active = false;
export async function analyzeFiles(request: unknown, config: Config, signal?: AbortSignal) {
  if (active) fail('BUSY', 'Only one analysis may run at a time.');
  if (process.env.OFFLOAD_WORKER === '1') fail('NESTED_INVOCATION_UNSUPPORTED', 'Offload workers cannot delegate again.');
  if (signal?.aborted) fail('CANCELLED', 'Operation cancelled.');
  active = true;
  const started = performance.now();
  try {
    const prepared = await prepare(request, config);
    const output = await invoke(prepared.config, prepared.prompt, prepared.snapshots, signal);
    if (Buffer.byteLength(JSON.stringify(output.content)) > prepared.config.limits.maxResultBytes) fail('OUTPUT_TRUNCATED', 'Worker answer exceeds its byte limit.');
    const answer = validateEvidence(output.content, prepared.snapshots);
    const result = {
      ...answer, sources: manifest(prepared.snapshots),
      evidence: 'Source IDs, line ranges, and supplied quotes verified; interpretations are not independently verified.',
      usage: output.usage, durationMs: Math.round(performance.now() - started), cache: 'disabled', promptVersion,
      provider: { type: prepared.config.provider.type, requestedModel: prepared.config.provider.model, model: output.model, cliVersion: output.version, destination: prepared.config.provider.destination },
      warnings: [...answer.warnings, 'Requested output tokens are advisory; captured bytes are bounded.', 'CLI-added context and provider-side retention are outside Offload control.'],
    };
    if (Buffer.byteLength(JSON.stringify(result)) > prepared.config.limits.maxResultBytes - 256) fail('OUTPUT_TRUNCATED', 'Final response and source manifest exceed the result budget.');
    return result;
  } finally { active = false; }
}
