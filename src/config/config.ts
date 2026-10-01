import { createHash } from 'node:crypto';
import { lstat, mkdir, open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configSchema, limitsSchema, parseJson, validate, type Config, type Profile } from '../core/schema.js';
import { fail } from '../core/errors.js';
import { readBoundedFile } from '../files/snapshots.js';

export function configPath(): string {
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'offload', 'config.json');
}

export function defaultConfig(type: Profile['type'] = 'claude-cli'): Config {
  return {
    schemaVersion: 1,
    provider: { type, executable: type === 'claude-cli' ? 'claude' : type === 'codex-cli' ? 'codex' : 'mock', model: null, destination: type === 'claude-cli' ? 'anthropic' : type === 'codex-cli' ? 'openai' : 'offline' },
    limits: limitsSchema.parse({}), authorization: null,
  };
}

export async function loadConfig(explicit?: string): Promise<{ config: Config; provenance: string }> {
  const file = explicit ?? configPath();
  if (!explicit) {
    // Only an absent default config falls back. Malformed/unreadable configs fail.
    try { await lstat(file); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { config: defaultConfig(), provenance: 'built-in defaults (not authorized)' };
      throw error;
    }
  }
  const bytes = await readBoundedFile(file, 65536);
  return { config: validate(configSchema, parseJson(bytes.toString('utf8'))), provenance: path.resolve(file) };
}

export function profileHash(profile: Profile): string {
  return createHash('sha256').update(JSON.stringify([profile.type, profile.executable, profile.model, profile.destination])).digest('hex');
}

export async function saveConfig(file: string, config: Config): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch { return fail('TARGET_CONFLICT', 'Configuration already exists or cannot be created; choose a new --config path or edit it explicitly.'); }
  try { await handle.writeFile(`${JSON.stringify(validate(configSchema, config), null, 2)}\n`); }
  finally { await handle.close(); }
}
