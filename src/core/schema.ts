import { z } from 'zod';
import { fail } from './errors.js';

export const limitsSchema = z.object({
  maxFiles: z.number().int().min(1).max(20).default(20),
  maxFileBytes: z.number().int().min(1).max(262144).default(262144),
  maxCorpusBytes: z.number().int().min(1).max(524288).default(524288),
  maxOutputTokens: z.number().int().min(1).max(4000).default(1200),
  maxResultBytes: z.number().int().min(256).max(65536).default(16384),
  timeoutSeconds: z.number().int().min(1).max(600).default(120),
  contextTokens: z.number().int().min(4096).max(1000000).default(16000),
}).strict();
export type Limits = z.infer<typeof limitsSchema>;

export const profileSchema = z.object({
  type: z.enum(['mock', 'claude-cli', 'codex-cli']),
  executable: z.string().min(1).max(4096),
  model: z.string().min(1).max(200).nullable().default(null),
  destination: z.enum(['offline', 'anthropic', 'openai']),
}).strict();
export type Profile = z.infer<typeof profileSchema>;

export const configSchema = z.object({
  schemaVersion: z.literal(1),
  provider: profileSchema,
  limits: limitsSchema.default(() => limitsSchema.parse({})),
  authorization: z.object({ profileHash: z.string(), cliVersion: z.string() }).strict().nullable().default(null),
}).strict();
export type Config = z.infer<typeof configSchema>;

export const requestSchema = z.object({
  question: z.string().trim().min(1).max(8000),
  paths: z.array(z.string().min(1).max(4096)).min(1).max(20),
  root: z.string().min(1).optional(),
}).strict();
export type ReadRequest = z.infer<typeof requestSchema>;

export const answerSchema = z.object({
  answer: z.string().min(1).max(8000),
  findings: z.array(z.object({
    sourceId: z.string().max(30),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    quote: z.string().max(2000).nullable(),
    explanation: z.string().min(1).max(3000),
  }).strict()).max(40),
  coverage: z.object({
    status: z.enum(['complete', 'partial']),
    inspectedSourceIds: z.array(z.string()).max(20),
    omissions: z.array(z.object({ sourceId: z.string(), reason: z.string().min(1).max(500) }).strict()).max(20),
  }).strict(),
  warnings: z.array(z.string().max(500)).max(20),
  unresolvedQuestions: z.array(z.string().max(500)).max(20),
}).strict();
export type Answer = z.infer<typeof answerSchema>;

export function validate<T>(schema: z.ZodType<T>, value: unknown, kind: 'INVALID_REQUEST' | 'OUTPUT_INVALID' = 'INVALID_REQUEST'): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) fail(kind, `Invalid ${kind === 'OUTPUT_INVALID' ? 'worker response' : 'request or configuration'}; check the documented schema.`);
  return parsed.data;
}

export function parseJson(text: string, kind: 'INVALID_REQUEST' | 'OUTPUT_INVALID' = 'INVALID_REQUEST'): unknown {
  try { return JSON.parse(text) as unknown; }
  catch { return fail(kind, 'Expected valid JSON.'); }
}
