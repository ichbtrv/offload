# Offload

[![CI](https://github.com/ichbtrv/offload/actions/workflows/ci.yml/badge.svg)](https://github.com/ichbtrv/offload/actions/workflows/ci.yml)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Offload is a security-first TypeScript CLI for giving a coding agent's native subagent a bounded set of source snapshots, then validating the evidence it returns. It keeps file selection, budgets, hashes, citations, and cleanup under local control while reusing the current Codex or Claude Code session.

This repository is a completed portfolio MVP focused on one production-quality vertical slice: bounded source analysis. Candidate generation, caching, MCP, and local-model adapters are intentionally kept on the roadmap instead of being represented as finished features.

## Why it exists

Broad source questions can flood the primary agent's context or tempt an unrestricted repository scan. Offload makes that handoff explicit and reviewable:

```text
explicit files -> private bounded packet -> native subagent -> checked citations -> targeted review
```

- Canonical path and sensitive-file checks happen before packet creation.
- Source bodies stay out of the parent command result.
- Coverage, source IDs, line ranges, optional quotes, and source hashes are validated.
- Changed sources, malformed answers, oversized payloads, and unsafe cleanup fail closed.
- The offline test suite exercises provider, process, path, integration, and evidence failure modes.

**Default integration: native delegation.** `prepare`, `complete`, and `discard` handle local packets and citation validation; your current agent launches the subagent. Native workers follow host permissions, not standalone snapshot-only isolation. Codex native fixture delegation has been demonstrated; the Claude definition passes CLI validation, but a live Claude-host session still needs verification. See [verification status](docs/verification.md).

The original standalone `init`, `doctor`, and `read` route remains available separately. Its Claude adapter requires an authorized profile; its Codex worker remains disabled until snapshot-only isolation is verified. Those restrictions do not block native delegation.

Generation/application, hooks, caching, MCP, chunking, and Ollama remain later phases, as specified in [the build brief](Local-Offload-Build-Brief.md).

The [verification report](docs/verification.md) records what has been demonstrated and what remains environment-dependent. The [roadmap](docs/next-steps.md) keeps future acceptance work separate from implemented behavior.

## Quick start

Use Node 24 LTS (`.nvmrc`); Node 22+ is supported. On this machine the default shell had Node 18, so select the newer runtime first.

```sh
nvm use
npm ci --ignore-scripts
npm run verify
npm run demo
```

The demo uses only synthetic fixture files and no model or login. The mock explicitly labels its output as deterministic evidence, not a semantic answer.

The CI matrix runs on Node 22 and 24 across Linux and macOS. `npm run test:coverage` produces a local report with Node's built-in test runner; no coverage service or live model account is required.

```sh
node dist/src/cli/main.js read \
  --provider mock --root tests/fixtures/workspace \
  --paths session.ts auth.ts \
  --question "Where is expiration checked?" --json

node dist/src/cli/main.js read \
  --root tests/fixtures/workspace --paths session.ts auth.ts \
  --question "Where is expiration checked?" --dry-run --json
```

The package declares an `offload` executable. Running the built entry point directly avoids a global install. All examples below can use `node dist/src/cli/main.js` in place of `offload`.

## Architecture

| Layer | Responsibility |
| --- | --- |
| CLI | Stable JSON envelopes, argument validation, signals, and exit codes |
| Core | Request budgeting, orchestration, evidence validation, and native job lifecycle |
| Files | Canonical containment, exclusions, bounded snapshots, UTF-8 handling, and hashes |
| Providers | Strict Claude/Codex response parsing plus a deterministic offline mock |
| Integrations | Idempotent project-local Codex and Claude instructions and launcher |

The library exports the same analysis and native orchestration primitives used by the CLI. See [CLI and configuration](docs/cli.md), [security boundaries](docs/security.md), and [verification evidence](docs/verification.md) for the detailed contracts.

## Use from Codex or Claude Code

After building with Node 22+, install into your chosen project:

```sh
node dist/src/cli/main.js integrate --root /absolute/target-project --json
```

This preserves existing `AGENTS.md` and `CLAUDE.md` content, adds native workflow instructions, installs `.claude/agents/offload-reader.md` with `model: inherit`, and creates `.offload-local/offload`. Keep `.offload-local/` ignored. Its launcher pins this checkout and the installing Node runtime, avoiding nvm setup in agent shells.

Start a fresh Codex or Claude session. Ask a source question normally; the instructions direct the agent to delegate suitable broad questions and validate the answer. No separate worker model, `init`, or Claude login is needed inside Codex. Host subagent defaults and administrative model overrides still apply.

The host performs this sequence:

```sh
rtk proxy ./.offload-local/offload prepare --host codex \
  --root tests/fixtures/workspace --paths session.ts auth.ts \
  --question "Where is expiration checked?" --json
# The host gives result.workerInstruction to its native subagent.
# The subagent reads promptFile and writes answerFile.
rtk proxy ./.offload-local/offload complete --job JOB_FROM_PREPARE --json
```

Claude uses `--host claude` and its installed `offload-reader` subagent. The main agent receives metadata and the checked answer, not the full packet. Jobs temporarily store source snapshots in private system-temp directories; successful completion removes them. Stop failed/abandoned workers and run `discard --job JOB --json` to clean up. Native calls consume your host account's usage.

Remove with `node dist/src/cli/main.js integrate --root /absolute/target-project --remove --json`. Installation is project-local; no global agent settings or hooks are changed. See [the integration contract](docs/cli.md#project-integration).

## Optional standalone hosted worker

```sh
offload doctor --provider claude-cli --json
offload doctor --provider codex-cli --json
offload init --provider claude-cli --model YOUR_FULL_CLAUDE_MODEL_ID \
  --context-tokens 16000 --json
```

`init` first returns a consent preview. It does not run inference or write hosted configuration without `--authorize-remote`. Choose a full model ID available to your account and a verified context capacity, then repeat with `--authorize-remote`. That saves authorization for the resolved executable, detected version, selected model, and Anthropic destination. A CLI version or profile change requires new authorization. Existing configs are never overwritten; use a new `--config PATH` or edit deliberately.

The selected source text and your question normally leave your computer through the CLI's hosted provider. Existing login alone is not consent, and calls may consume account usage. Offload neither installs models nor switches accounts or providers.

```sh
offload read --paths src/core/analyze.ts src/files/snapshots.ts \
  --question "How are source citations verified?" --json
```

Paths resolve against the Git worktree root, or an explicit `--root`. A non-Git folder requires `--root`. File globs are unsupported. `--provider mock` is the only per-read provider override and never contacts a model.

For requests too large for arguments, supply a JSON file or stdin:

```json
{
  "root": "/absolute/workspace",
  "question": "Where is session expiration checked?",
  "paths": ["src/auth.ts", "src/session.ts"]
}
```

```sh
offload read --request-file request.json --json
offload read --request-file - --json < request.json
```

## Library

`analyzeFiles(request, config, signal?)` and `inspectRequest(request, config)` are exported from `dist/src/index.js`. The exported schemas validate requests, configuration, and answers. Generation functions are not exported until implemented.

Native orchestration exports `prepareNative(request, host, limits?)`, `completeNative(job)`, and `discardNative(job)`. These perform no inference; the caller controls the host subagent lifecycle.

The short [Codex snippet](src/integrations/codex/AGENTS.snippet.md) and [Claude snippet](src/integrations/claude/CLAUDE.snippet.md) remain available for manual setups. No global agent settings or hooks are installed automatically.

See [CLI and configuration](docs/cli.md), [security and compatibility](docs/security.md), and [verification status](docs/verification.md) for the exact boundaries.
# offload
