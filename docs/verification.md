# Verification status

## Native integration (updated 2026-10-01)

The user approved native host delegation as the default, using the current agent's model-selection rules and login. The standalone snapshot-only acceptance gate remains separate.

- Node 24.14.1: strict build and all **36 offline tests pass**. Native tests cover both host labels, metadata-only parent output, private packet permissions, practical multi-file context capacity, malformed/oversized responses, fabricated quotes, source changes, coordinated state/packet replacement, symlink rejection, cleanup, CLI transport, and both instruction installations with conflict preservation.
- Node 24.14.1 built-in coverage reports **96.88% line**, **81.37% branch**, and **93.62% function** coverage across source files. `npm pack --dry-run` succeeds with an isolated cache and produces a 48-file, 48.1 kB package containing the compiled library/CLI, declarations, source maps, README, and docs.
- Installed locally in this checkout: managed AGENTS.md and CLAUDE.md blocks, `.claude/agents/offload-reader.md` (`model: inherit`), and an ignored `.offload-local/offload` launcher pinned to Node 24. No global agent configuration was changed.
- Claude Code 2.1.278: `claude plugin validate .claude/agents` passes. This verifies definition parsing, not live Claude-host behavior.
- Real native Codex subagents were spawned in this session with minimal context and no model/effort override. Only packet paths and worker instructions were passed; the main agent did not ingest the source packet. No standalone CLI worker, separate login, model pin, or cross-provider route was used.

| Synthetic question | Observed result | Validation | Job wall time |
| --- | --- | --- | --- |
| Where is session expiration checked, and what happens when expired? | `now >= expiresAt`; authorize returns its negation, so expiration yields false | Both source hashes, coverage, ranges and quotes passed; original lines reviewed afterward | 35,292 ms |
| Which database stores sessions, and how long do its records live? | Explicitly unknown from these snapshots; storage, assignment of expiresAt, and deletion listed as unresolved | Both source hashes, coverage, ranges and quotes passed | 85,262 ms |

Times include host scheduling and the parent's other work before completion; they are not inference-latency measurements. Model selection was requested to inherit; the CLI cannot independently observe actual model identity or token usage, so both remain unknown. Both successful jobs were removed by complete.

Fixture identity:

- `tests/fixtures/workspace/session.ts`: `df8df744fc8a8d61b6e3a5418ece76f6a1a74a91484a02a53dc94b9f6a2acc3f`
- `tests/fixtures/workspace/auth.ts`: `1aa70fca357ce08213bb47d66ffd249a354538e9dc01a88928d2b76d250a6bec`

Reproduce in a native Codex host (use `--host claude` and the offload-reader subagent in Claude):

```sh
rtk proxy ./.offload-local/offload prepare --host codex --root tests/fixtures/workspace --paths session.ts auth.ts --question "Where is expiration checked?" --json
# Give result.workerInstruction to a native subagent with inherited model selection.
# Wait for it to write result.answerFile, then:
rtk proxy ./.offload-local/offload complete --job JOB_FROM_PREPARE --json
```

Native workers follow host permissions. These demonstrations do not certify snapshot-only isolation, injection resistance, cost savings, or voluntary discovery in a fresh session. Live Claude-host use, fresh-session adoption on both hosts, and host timeout/cancellation behavior remain to be verified.

## Authentication finding

Claude Pro login is saved correctly: a read-only Offload doctor outside the Codex sandbox reported `authenticated: true` and `policySupported: true` for Claude 2.1.278. The sandboxed check reported no login. Repeating login is not the fix for that sandbox visibility difference. Native Codex delegation does not need Claude authentication at all. No standalone model/profile was authorized.

## Standalone baseline verification (historical)

Validated locally with Node 24.14.1 on macOS:

- Strict TypeScript build and offline Node test runner.
- Synthetic two-file read returning checked IDs, ranges, quotes, hashes, coverage, and unknown usage.
- Dry-run manifest and budgets without authentication or inference.
- Full CLI request-file/stdin and single-envelope behavior.
- Fake Claude executable exercising consent, exact invocation, stdin, version gating, login failure, malformed output, overflows, redacted failures, and profile changes.
- Claude and Codex response-protocol contract tests, including unsuccessful/incomplete results and tool attempts.
- Path, encoding, exclusion, context-budget, citation, cancellation, concurrency, and process-tree cleanup tests.
- Real `doctor` probes only: Codex 0.155.1 reported a ChatGPT login but unsupported isolation; Claude reported no login in the execution environment. Claude versions 2.1.268 and 2.1.278 were observed and their restriction flags inspected.

The suite is offline; no account is required. CI is configured for Node 22 and 24 on Linux and macOS but has not yet run remotely. These standalone tests make no claims about live-model accuracy, subscription coverage, or measured token savings.

## Optional standalone live smoke test, when explicitly authorized

1. Use `doctor` to confirm an identifiable supported personal Claude login and no unsupported managed/custom routing policy.
2. Preview `init` with a full model ID and verified context budget, then save the exact profile with `--authorize-remote`.
3. Read only `tests/fixtures/workspace/session.ts` and `auth.ts`, asking where expiration is checked. Inspect coverage and the cited comparison.
4. Repeat with an unanswerable question and verify unresolved questions rather than fabricated evidence.
5. Use a synthetic instruction-injection file to confirm the model cannot invoke tools or read a neighboring synthetic secret. Inspect CLI-reported behavior in a controlled test; ordinary unit tests alone do not certify host isolation.
6. Record CLI/model identity, fixture hashes, actual usage when available, timing, correctness, and limitations before expanding to Phase 2.

No real repository-source inference, global agent configuration change, package publication, or model installation was performed during this implementation.
