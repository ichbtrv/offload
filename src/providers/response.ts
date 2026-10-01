import { z } from 'zod';
import { fail } from '../core/errors.js';
import { parseJson, validate } from '../core/schema.js';

const usageSchema = z.object({ input_tokens: z.number().nonnegative().optional(), output_tokens: z.number().nonnegative().optional() }).passthrough();
export interface ProviderOutput { content: unknown; usage: { inputTokens: number | null; outputTokens: number | null }; model: string | null }

export function parseClaudeOutput(stdout: string): ProviderOutput {
  const envelope = validate(z.object({
    type: z.literal('result'), subtype: z.string(), is_error: z.boolean(),
    result: z.string().optional(), structured_output: z.unknown().optional(),
    permission_denials: z.array(z.unknown()).optional(),
    usage: usageSchema.optional(),
    modelUsage: z.record(z.string(), z.unknown()).optional(),
    stop_reason: z.string().nullable().optional(),
  }).passthrough(), parseJson(stdout, 'OUTPUT_INVALID'), 'OUTPUT_INVALID');
  if (envelope.is_error || envelope.subtype !== 'success') fail('OUTPUT_INVALID', 'Claude returned an incomplete or unsuccessful result.');
  if (envelope.permission_denials?.length) fail('WORKER_POLICY_UNSUPPORTED', 'Worker attempted a denied tool operation.');
  if (envelope.stop_reason && !['end_turn', 'stop_sequence'].includes(envelope.stop_reason)) fail('OUTPUT_INVALID', 'Worker did not stop with a completed answer.');
  const models = Object.keys(envelope.modelUsage ?? {});
  if (models.length > 1) fail('MODEL_UNAVAILABLE', 'Worker used more than one model; automatic fallback is not accepted.');
  const content = envelope.structured_output ?? (envelope.result ? parseJson(envelope.result, 'OUTPUT_INVALID') : undefined);
  if (content === undefined) fail('OUTPUT_INVALID', 'Claude returned no final answer.');
  return { content, usage: { inputTokens: envelope.usage?.input_tokens ?? null, outputTokens: envelope.usage?.output_tokens ?? null }, model: models[0] ?? null };
}

// Parsing is independently tested even though current Codex execution is
// deliberately unavailable until snapshot-only isolation can be enforced.
export function parseCodexOutput(stdout: string): ProviderOutput {
  let final: string | undefined;
  let usage: ProviderOutput['usage'] = { inputTokens: null, outputTokens: null };
  let complete = false;
  for (const line of stdout.split('\n').filter(line => line.trim())) {
    const event = validate(z.object({ type: z.string() }).passthrough(), parseJson(line, 'OUTPUT_INVALID'), 'OUTPUT_INVALID');
    if (complete) fail('OUTPUT_INVALID', 'Unexpected events after Codex completion.');
    if (event.type === 'error' || event.type === 'turn.failed') fail('OUTPUT_INVALID', 'Codex returned an unsuccessful result.');
    if (event.type === 'item.started' || event.type === 'item.completed') {
      const item = validate(z.object({ type: z.string(), text: z.string().optional() }).passthrough(), event.item, 'OUTPUT_INVALID');
      if (!['agent_message', 'reasoning'].includes(item.type)) fail('WORKER_POLICY_UNSUPPORTED', 'Codex attempted a tool operation.');
      if (event.type === 'item.completed' && item.type === 'agent_message') {
        if (final !== undefined || item.text === undefined) fail('OUTPUT_INVALID', 'Expected exactly one final Codex answer.');
        final = item.text;
      }
    } else if (event.type === 'turn.completed') {
      const reported = validate(usageSchema, event.usage, 'OUTPUT_INVALID');
      usage = { inputTokens: reported.input_tokens ?? null, outputTokens: reported.output_tokens ?? null };
      complete = true;
    } else if (!['thread.started', 'turn.started'].includes(event.type)) fail('OUTPUT_INVALID', 'Unrecognized Codex event.');
  }
  if (!complete || final === undefined) fail('OUTPUT_INVALID', 'Codex did not complete a final answer.');
  return { content: parseJson(final, 'OUTPUT_INVALID'), usage, model: null };
}
