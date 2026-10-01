# CLI and configuration

Every command accepts `--json` and writes one envelope to stdout:

```json
{"ok":true,"schemaVersion":1,"requestId":"uuid","result":{}}
```

Failures use `{"ok":false,"schemaVersion":1,"requestId":"uuid","error":{"code":"INVALID_REQUEST","message":"..."}}` and a nonzero exit. Raw provider diagnostics are never included. Without `--json`, successful results are pretty-printed JSON and errors go to stderr.

`doctor` performs version/help/login checks, never inference. `ok: true` means diagnostics completed; inspect `result.ready`, `authorized`, and `status` to decide whether a read can run. Model entitlement cannot be established without an explicitly authorized inference call.

`init --provider mock --config PATH` saves an offline profile immediately. Hosted initialization previews by default and requires `--authorize-remote`, a full `--model` ID, and `--context-tokens` before saving. `--executable PATH` selects a trusted CLI. No overwrite option is provided. Configuration files are created mode 0600, with newly created parent directories mode 0700.

The default config is `$XDG_CONFIG_HOME/offload/config.json`, or `~/.config/offload/config.json`. An explicit `--config` is a user-selected trust source, so do not point it at an unreviewed repository file. Repository `.offload.json` files are not loaded in Phase 1. Environment variables cannot grant authorization. No inference is authorized by built-in defaults.

The runtime config schema is exported as `configSchema`. Hard limits cannot be raised beyond the schema's ceilings; trusted config can lower them. Defaults:

| Limit | Default | Maximum |
| --- | ---: | ---: |
| Selected files | 20 | 20 |
| File bytes | 262144 | 262144 |
| Corpus bytes | 524288 | 524288 |
| Requested output tokens | 1200 | 4000 |
| Final result bytes | 16384 | 65536 |
| Provider/preflight timeout seconds | 120 | 600 |
| Configured context tokens | 16000 | 1000000 |

The serialized prompt includes exact UTF-8 text and numbered lines. Budgeting conservatively estimates one token per serialized byte and reserves 4096 tokens for CLI context, plus the output allowance. This often makes the effective file budget much lower than the byte ceiling. Context estimates and output-token requests are advisory; captured bytes and elapsed time are enforced. Oversized requests and responses fail without truncation or retries. Request/config JSON is limited to 64 KiB, worker stdin to 1 MiB, stderr to 64 KiB, and transport stdout to the result limit plus 64 KiB of envelope overhead.

Source IDs, SHA-256 hashes, relative paths, and included line ranges are returned separately from the worker prompt, which uses IDs and content without paths. Each returned citation and optional quote is checked against the exact snapshot. Quotes use LF-normalized line boundaries for CRLF files. Hashes cover original bytes, including BOMs and line endings. An empty file has no citeable lines. Every source must be accounted for in coverage; partial analysis is explicit. Citation validity does not establish that an interpretation is correct.

Usage is `null` when unknown. The requested model and provider-reported model are separate fields; unknown identity remains `null`. A reported model change or multiple models fails instead of being silently accepted.

## Native host workflow

`prepare --host codex|claude --question QUESTION --paths FILE... [--root ROOT] --json` captures and budgets explicit sources locally. `--request-file PATH|-` accepts the same request schema as standalone read, instead of question/paths/root flags. No standalone configuration, provider probing, authorization, or inference occurs. Native preparation defaults to a conservative 64,000-token context budget so useful multi-file packets fit current host models; callers of the library can supply stricter validated limits explicitly. Standalone profiles retain their configured context budget.

The result contains a private temporary `job`, `promptFile`, `answerFile`, source metadata, and `workerInstruction`; no source bodies. The host passes the instruction to one native subagent with inherited model selection. The worker reads the packet and writes raw answer JSON matching its response schema to answerFile. It should return only a short completion notice to the host.

`complete --job JOB --json` bounds and parses answer.json, verifies the state identity bound into the job path, checks the packet hash, recaptures the selected sources and compares hashes, validates citations and coverage, and returns a compact answer with `executionPolicy: "host-permissions"`. Provider metadata identifies the host and requested inheritance; actual model and usage are null because this local CLI cannot observe host inference. Duration measures preparation-to-completion wall time, including host scheduling, not pure model latency. Success removes the packet. Validation failure retains it for explicit cleanup.

`discard --job JOB --json` removes only known job files and the empty directory. Stop the host worker first. Unknown files cause TARGET_CONFLICT and require inspection/manual cleanup. Only Offload native job directories directly under the system temporary directory are accepted; symlink directories/files are refused for reads. Crashes may leave packets behind. There is no automatic expiry or sweeper.

The host is responsible for timeout (instructions specify 120 seconds), cancellation, one-worker-at-a-time scheduling, model inheritance, and tool permissions. Offload's limits and evidence checks apply locally; it does not enforce native snapshot-only tool isolation. Native mode never invokes a nested CLI, changes login, or silently falls back to a standalone provider.

## Project integration

`integrate --root PROJECT [--remove] --json` installs/removes native Codex and Claude integrations. It writes `.offload-local/offload` (mode 0700), managed `<!-- offload:begin -->` blocks in both `AGENTS.md` and `CLAUDE.md`, and `.claude/agents/offload-reader.md` (model: inherit, Read/Write only). Existing instruction bytes outside the blocks are preserved. Repeated installation is idempotent. All target conflicts are checked before changes; this is not an atomic multi-file filesystem transaction.

Existing instruction files must end with a newline before first installation. Malformed/duplicate markers, symlink targets or parent directories, and modified/conflicting integration-owned files fail with TARGET_CONFLICT. Uninstall preserves unrelated instructions/files and leaves created directories in place. Reinstalling upgrades the old Codex-only managed block to native mode.

The launcher pins the current Node executable and built CLI entry point, with quoting for spaces/apostrophes. No startup build or nvm initialization is needed. Keep the checkout and runtime in place; remove using the original installation before relocation/reinstallation. Add `.offload-local/` to target ignore rules. The instruction blocks use RTK to match this project's agent conventions.

No global settings, hooks, standalone authorization, account selection, or host model defaults are modified. Fresh host sessions discover the new files. Native subagent availability and any administrative overrides remain host-controlled. `doctor` still diagnoses only the separate standalone adapter; its readiness is not a prerequisite for native use.

## Stable exit codes

| Code | Exit |
| --- | ---: |
| `INVALID_REQUEST` | 2 |
| `PATH_DENIED` | 3 |
| `FILE_UNSUPPORTED` | 4 |
| `BUDGET_EXCEEDED` | 5 |
| `PROVIDER_UNAVAILABLE` | 6 |
| `MODEL_UNAVAILABLE` | 7 |
| `TIMEOUT` | 8 |
| `OUTPUT_INVALID` | 9 |
| `OUTPUT_TRUNCATED` | 10 |
| `SOURCE_CHANGED` | 11 |
| `TARGET_CONFLICT` | 12 |
| `REMOTE_NOT_AUTHORIZED` | 13 |
| `AUTH_REQUIRED` | 14 |
| `CLI_UNSUPPORTED` | 15 |
| `WORKER_POLICY_UNSUPPORTED` | 16 |
| `NESTED_INVOCATION_UNSUPPORTED` | 17 |
| `CANCELLED` | 18 |
| `BUSY` | 19 |
| `INTERNAL_ERROR` | 20 |

Only one analysis runs per process. Live workers also hold a per-user lock directory named `offload-worker-UID.lock` under the OS temporary directory. Normal completion and cancellation remove it. If the wrapper itself is force-killed, first confirm no worker remains before removing that specific stale directory manually. Offload does not guess that a lock is stale or start a second worker automatically.
