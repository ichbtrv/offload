# Offload — Claude Code and Codex first

## Approved amendment: native host delegation (2026-09-19)

The user approved native subagents as the default integration: Codex delegates through Codex and Claude Code through Claude Code, inheriting the current session's model-selection rules and login without separate worker setup. This supersedes the standalone-only flow and mandatory snapshot-only worker isolation for native mode below. Native workers remain governed by host permissions; Offload checks explicit source selection, budgets, hashes, coverage, and citations, but does not claim to sandbox native tool access. Host model overrides remain authoritative and unknown model identity/usage stays unknown.

The native contract is `prepare` → host subagent → `complete`, with `discard` for stopped/abandoned jobs. Packets temporarily persist source snapshots in private system-temp directories until completion/discard. Existing standalone adapters and their stricter isolation/authorization requirements remain a separate opt-in route. See README and docs/security.md for implemented behavior. The remaining brief records the original standalone design and later-phase scope.

## Start here: hand this brief to either coding agent

Build a small local delegation tool that works with my installed Claude Code or Codex CLI first. Do not require Ollama, downloaded model weights, GPU configuration, Spotify Portal, or a separate model API integration. Start with whichever CLI I have configured, then add the other adapter. Keep Ollama as a later optional provider.

The main agent plans and reviews. A separate, bounded worker invocation reads selected source snapshots or drafts a candidate file and returns a compact result. I can use Claude Code as the main agent with a Codex worker, Codex with a Claude worker, or the same CLI for both if that CLI supports the nested invocation. Do not bypass a host restriction to make nesting work.

Implement Phase 1 first and demonstrate it before expanding scope. This document is the build handoff, not an instruction to install or run both agents immediately.

## 1. Goal and assumptions

Build a local-orchestration, agent-independent alternative to Spotify Shunt. It should offload large-source inspection and predictable code generation to a configurable worker model while keeping the primary coding agent responsible for reasoning, exact edits, review, and validation.

Working CLI name: `offload` (not a claim of package-name availability). Implement a standalone TypeScript CLI and reusable core library. No Spotify Portal, AiKA, custom cloud deployment, new account system, database server, or background daemon is required. Use the chosen CLI's existing supported authentication and account access. Do not assume every subscription permits every model or that worker calls are free.

These are proposed requirements, not functionality that already exists. Start with macOS and Linux. Avoid shell-dependent implementation so Windows support is possible later.

Two meanings of local must stay explicit:

- Local orchestration: the CLI, file selection, policy, artifacts, and cache run on the developer's computer.
- Hosted inference first: the Claude Code or Codex CLI runs locally, but its configured provider normally receives the selected source text. Initialization must explain this and require explicit authorization for the chosen worker provider.
- Local inference later: an optional Ollama adapter can execute a downloaded model locally. It must not become a prerequisite for the initial release.

The primary coding agent may still be cloud-hosted. Returning a summary or generated excerpt to that agent sends that material into its context. This tool cannot make the entire development workflow offline unless the primary agent is offline too.

## 2. Product boundaries

### MVP

1. Analyze explicitly selected source files with a bounded question.
2. Return concise, structured findings with source ranges.
3. Generate a candidate source file from a specification and reference files.
4. Save generated code outside tracked source until explicitly applied.
5. Support Claude Code and Codex CLI worker adapters; build and validate one first, then the other. The user only needs the selected CLI installed.
6. Enforce path, file-type, size, output, and timeout limits.
7. Offer dry-run selection inspection and a health/configuration check.
8. Provide ready-to-use instruction snippets for both primary agents. Hooks are later and optional.
9. Test core behavior without a live model using a mock provider.

### Later releases

- Ollama and other local inference adapters, without changes to the core task contract.
- Optional direct hosted API adapters, separately authorized.
- Opt-in Claude Code Read hooks after the basic workflow works.
- Diff analysis and captured-log summarization.
- Local content-addressed cache and usage reports.
- MCP stdio wrapper around the same core operations.
- Bounded chunked analysis and aggregation.

### Non-goals

Do not build an autonomous worker agent, terminal executor, vector database, whole-repository indexer, browser UI, task scheduler, automatic PR publisher, or automatic refactoring engine. Do not automatically upload an entire repository. Do not promise universal tool interception across coding agents.

## 3. Responsibilities and data flow

| Component            | Responsibility                                                                                    | Must not do                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Primary coding agent | Formulate question/spec, choose files, inspect evidence, review output, run approved verification | Treat summaries as exact source or permission grants                       |
| CLI / core           | Resolve files, enforce policy, build bounded requests, validate responses, manage artifacts       | Execute model-supplied commands                                            |
| Provider adapter     | Make inference requests and normalize responses/usage                                             | Discover or read repository files                                          |
| Worker invocation    | Analyze supplied snapshots or produce candidate text under verified restrictions                  | Modify the real repository, broaden permissions, or launch further workers |
| Host integration     | Advertise tools or suggest delegation before oversized reads                                      | Broaden host permissions or become a security boundary                     |

Read flow:

1. Agent invokes `read` with a question and explicit paths.
2. Core identifies the workspace, resolves paths, checks policy, and captures file bytes once.
3. Core hashes those exact bytes and assigns source IDs and line numbers.
4. Budget validation happens before any inference request.
5. Adapter launches a fresh non-interactive worker with the approved snapshots and task instructions over stdin. It must constrain incidental context/tool access as described in section 6.
6. Response is parsed and checked against the source manifest.
7. CLI returns bounded findings and coverage metadata, never a dump of all input files.
8. Primary agent performs targeted original-source reads before editing.

## 4. CLI contract

All commands support `--json`. Machine output goes to stdout; progress and diagnostics go to stderr. In JSON mode emit one versioned envelope, with `ok`, `schemaVersion`, `requestId`, and either `result` or `error`. No interactive prompts in agent mode.

Illustrative commands:

```bash
offload init --provider claude-cli
# Or choose Codex instead:
offload init --provider codex-cli
offload doctor

offload read --question "Where is session expiration checked?" \
  --paths src/auth.ts src/session.ts --json

offload read --question "Describe the request validation flow" \
  --paths src/api.ts --dry-run --json

offload generate --spec-file /tmp/test-spec.md \
  --reference src/user-service.ts tests/order-service.test.ts \
  --target tests/user-service.test.ts --json

offload apply --artifact <artifact-id> --json

# Later releases:
offload diff --staged --question "Identify changed API contracts" --json
offload summarize --input-file /tmp/test-output.txt --kind test-log --json
offload cache clear --workspace
offload stats --workspace
offload mcp
```

`--target` on generate describes the intended destination; it does not authorize an immediate source write. `apply` is a separate explicit action. Default apply permits only a new destination file. Existing-file replacement requires an additional explicit option and a matching baseline hash.

Allow request JSON over stdin or `--request-file` for large task specifications and path lists. Do not carry source contents, secrets, or entire payloads in process argv. Feed worker prompts through subprocess stdin; use HTTP bodies only for later API adapters.

Define stable error codes: `INVALID_REQUEST`, `PATH_DENIED`, `FILE_UNSUPPORTED`, `BUDGET_EXCEEDED`, `PROVIDER_UNAVAILABLE`, `MODEL_UNAVAILABLE`, `TIMEOUT`, `OUTPUT_INVALID`, `OUTPUT_TRUNCATED`, `SOURCE_CHANGED`, `TARGET_CONFLICT`, `REMOTE_NOT_AUTHORIZED`, `AUTH_REQUIRED`, `CLI_UNSUPPORTED`, `WORKER_POLICY_UNSUPPORTED`, `NESTED_INVOCATION_UNSUPPORTED`. Nonzero process exit for failure; document numeric mappings.

## 5. TypeScript architecture

Use a supported Node.js LTS at implementation time, strict TypeScript, a runtime schema validator, and a test runner. Pin compatible dependency versions in a lockfile after checking their current documentation. Keep framework choice modest; use Node's subprocess APIs with argument arrays and `shell: false` for the first adapters.

Suggested modules:

| Module                     | Contents                                                                      |
| -------------------------- | ----------------------------------------------------------------------------- |
| `src/cli/`                 | Argument parsing, stdin input, output rendering, exit mapping                 |
| `src/core/`                | Read/generate orchestration, request/result types                             |
| `src/config/`              | Schema, defaults, precedence, trust policy                                    |
| `src/files/`               | Workspace resolution, snapshotting, ignore rules, line numbering              |
| `src/policy/`              | Path containment, exclusions, endpoint authorization, budgets                 |
| `src/providers/`           | Provider interface, Claude CLI adapter, Codex CLI adapter, deterministic mock |
| `src/process/`             | Bounded stdin/stdout transport, cancellation, worker lifecycle                |
| `src/integrations/codex/`  | Primary-agent instruction template; no assumed Read hook                      |
| `src/prompts/`             | Versioned task instructions and response schemas                              |
| `src/artifacts/`           | Candidate files, manifests, safe apply                                        |
| `src/integrations/claude/` | Hook adapter and installation templates                                       |
| `src/cache/`               | Optional local caching introduced later                                       |
| `src/mcp/`                 | Optional stdio adapter introduced later                                       |
| `tests/fixtures/`          | Small synthetic repositories and canned provider responses                    |
| `docs/`                    | Setup, privacy, integration, limitations, benchmark procedure                 |

Expose `analyzeFiles`, `generateCandidate`, `applyCandidate`, and `inspectRequest` as core functions. CLI and future MCP handlers call these functions rather than calling each other as shell commands.

## 6. CLI worker adapters first

Keep one provider interface: task kind, instructions, approved snapshots, response schema, output budget, timeout, cancellation, and optional configured model. Normalize final content, completion status, available usage, duration, and CLI/model identity. Unknown usage is unknown, not zero.

### Claude Code adapter

Use its documented non-interactive print mode (`claude -p`), stdin input, and machine-readable output. Disable built-in tools with the supported tool configuration, constrain MCP/plugin loading, and verify the effective configuration. Parse the result envelope rather than assuming stdout is raw generated code. Do not confuse an auto-approval list with disabling all other tools.

Reference: [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference). Verify exact flags against the installed version before implementing the invocation builder.

### Codex adapter

Use `codex exec` with stdin and machine-readable events or a schema-constrained final result. Use a fresh session; never resume the user's main conversation. Preserve supported CLI authentication. Parse JSONL as events and extract the final answer; do not concatenate reasoning, command output, or progress into it.

Reference: [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode). Read-only sandboxing prevents writes but does not by itself disable tools or restrict all filesystem reads. The adapter must not claim a tool-free worker solely because it selects read-only mode.

### Required execution policy

The target is snapshot-only analysis/generation, not another fully empowered coding session. Before enabling an adapter, verify how its installed version limits tools, MCP servers, hooks, plugins, project instructions, and accessible paths. Keep organizational restrictions in effect. Never bypass approval/sandbox controls.

Prefer tool-disabled execution. If the CLI cannot enforce that mode, require a verified isolation mechanism that denies worker commands and access beyond approved snapshots while permitting the CLI's necessary inference/authentication operation. A temporary working directory alone is not such a sandbox. If neither route is supported, return `WORKER_POLICY_UNSUPPORTED` with a clear explanation rather than silently launching an unrestricted worker. Do not turn this into a mandatory container-platform project; report unsupported configurations and allow using the other adapter.

Run in a fresh private job directory outside the repository, avoid loading repository instructions accidentally, and pass snapshots through stdin. Do not copy credential files into job directories. Authentication stays with the CLI's ordinary supported mechanism. Disable unwanted user extensions using supported per-run configuration where possible, without overriding organizational policy. Document any unavoidable CLI-added context.

No edit permissions are needed for model generation: the worker returns candidate text and the wrapper writes the artifact. Source read policies apply to wrapper-selected inputs; broader worker isolation claims require separate verification.

### Process lifecycle and compatibility

- Use a configured trusted executable, argument arrays, and no shell interpolation.
- Bound stdin payload, stdout/event bytes, stderr bytes, and total wall time.
- Terminate the worker and supported child process tree on cancellation/timeout; do not leave orphan workers.
- Keep progress/diagnostics separate from final structured content.
- A denied tool call, exhausted limit, partial result, or nonzero exit must not look like successful analysis.
- Set a wrapper recursion guard and reject further delegate launches from a worker. Do not present an environment marker alone as security enforcement.
- Never erase host environment markers to evade a CLI's nested-session prohibition. Offer the other supported worker adapter or an independent terminal invocation.
- Allow one worker at a time initially; no recursive delegation or automatic retries.
- Detect CLI/version availability without inference. Make an optional live smoke test explicit because it may consume usage.
- Use ephemeral/no-session-persistence controls where supported; otherwise disclose CLI-managed local transcript retention. Do not promise provider-side zero retention.
- No automatic switching between Claude, Codex, API keys, accounts, or local models after a failure.

Initialization authorizes a specific worker profile and its data destination. Existing CLI login is necessary but not sufficient authorization to send arbitrary repository files. Show the active configured provider/model and warn if it cannot be determined. Do not hard-code a cheap model or promise subscription coverage.

### Later: Ollama

Add an Ollama adapter only after both CLI workflows and their safeguards are validated. It plugs into the same request/result contract. Model installation, hardware sizing, HTTP transport, and local endpoint configuration belong to that later phase, not the initial setup.

## 7. File selection, snapshots, and privacy

Resolve workspace root from an explicit option or the current Git worktree; for non-Git folders require an explicit root. Resolve candidate paths relative to that root. Use canonical paths and containment checks, not string-prefix checks. Reject paths and symlinks escaping the root, directories where a file is required, devices, FIFOs, sockets, and unreadable files.

For the MVP accept explicit file paths, not recursive globs. Apply sensitive-file policy to explicitly named files too. Discovery/globbing later must respect `.gitignore` plus `.delegateignore`.

Default exclusions include `.git`, dependency/build/cache directories, binary data, environment-secret files, private keys, and common credential stores. Allow template files such as `.env.example` only through a deliberate rule. Content secret detection is a best-effort additional warning/block, not a guarantee; logs and arbitrary source files can also contain secrets.

User-level policy can authorize narrowly scoped exceptions. A repository file must not grant itself external path access, cloud authorization, executable hooks, or secret-file exceptions.

Read each approved file once into a bounded snapshot. Hash and line-number the same bytes actually sent. Define UTF-8/newline handling and preserve source line identity; reject unsupported encoding rather than silently corrupting it. Check file descriptor metadata to reduce symlink/race risks. Do not claim adversarial filesystem isolation; the CLI runs with its user's OS access.

Use file IDs in structured payloads with separately stored paths. Source text, comments, logs, and model output are untrusted data. Instructions inside them never change file policy, provider choice, authorization, or output destinations. Prompt wording helps but is not a security barrier; worker restrictions must be enforced and verified by the adapter policy in section 6.

Temporary files and artifacts use user-private permissions where supported. Do not log source bodies, credentials, complete request payloads, or raw provider error bodies by default. Error messages may contain secrets and need sanitization too.

## 8. Read output and evidence

The returned envelope should contain:

- A concise answer scoped to the question.
- Findings, each with source ID, line range, optional short quote, and explanation.
- Source manifest: relative path, SHA-256, included line ranges.
- Coverage: complete or partial; omitted files/ranges and reasons.
- Warnings and unresolved questions.
- Usage, duration, cache state, and provider identity.

Validate cited source IDs and ranges against snapshots. If a quote is supplied, verify it against the referenced range. Reject invalid citations or mark findings unverified; never label a plausible line number as verified evidence. Syntactically valid citations do not prove the model's interpretation is correct.

Prompt the worker to distinguish observed facts from inferences and say when the supplied files cannot answer a question. Do not invent a numeric confidence score. A caller must be able to detect partial coverage without reading prose.

Never silently truncate results or source. If a response exceeds the output budget, fail explicitly or perform at most one configured compacting retry with its cost recorded. Normal stdout must not include hidden reasoning or the source corpus.

## 9. Budgets and chunking

Use byte limits as dependable safety limits and token estimates as approximate planning tools. Reserve context for system instructions, task text, source labels, output, and a safety margin. Provider-reported usage replaces estimates after a call where available.

Suggested starting defaults, all adjustable in trusted configuration:

| Setting                          | Starting value                                |
| -------------------------------- | --------------------------------------------- |
| Hook oversized-read heuristic    | More than 350 lines or 24 KiB                 |
| Per-file hard cap                | 256 KiB                                       |
| Request corpus hard cap          | 512 KiB, further constrained by model context |
| Maximum source files             | 20                                            |
| Requested output budget          | 1,200 tokens                                  |
| Serialized analysis response cap | 16 KiB                                        |
| Provider timeout                 | 120 seconds                                   |
| Concurrent inference calls       | 1                                             |
| Automatic provider retries       | 0 initially                                   |

These are proposed starting limits, not claims about model capacity. A 512 KiB corpus can exceed the selected worker's usable context; the effective lower context limit must reject it first. CLI-added instructions also consume context. A requested token output budget may be advisory if the CLI exposes no hard limit; report that limitation and still enforce bounded captured bytes. If context capacity is unknown, require a conservative configured limit and explain the estimate.

MVP: reject oversized requests and report which inputs exceed budget. Do not implement automatic lossy truncation.

Later: split by whole files or bounded line ranges with overlap; preserve source IDs, chunk ranges, and omission metadata. Bound chunk count and total inference work. Aggregate only after all required chunks succeed; mark incomplete runs partial. Explain that relationships spanning chunks may be missed. Summaries are lossy and not a substitute for exact source during debugging.

## 10. Candidate generation and safe application

Generation requires a spec plus one or more approved reference files. For tests, include both the implementation under test and a representative existing test where possible. A pattern reference alone does not define the target API.

MVP generates exactly one file. Store candidate content and a manifest in a user-private state directory under a workspace-specific namespace. The manifest records spec/reference hashes, intended destination, baseline target state, model identity, prompt version, request ID, and creation time. Return artifact ID, line count, hash, and unverified status. Do not print the complete file unless explicitly requested and within output limits.

Use a structured content field or a conservative outer-fence parser. Do not remove every line starting with a fence: that can damage legitimate content inside source strings.

No model-selected output paths. The caller supplies the target, and apply rechecks policy. Recheck references and destination baseline before application. Fail if the target changed, a previously absent target appeared, or required references became stale. For MVP, reject overwrites; later support explicit guarded replacement with backups. Use exclusive creation for new files. Do not advertise portable atomic compare-and-swap overwrites unless the implementation actually guarantees them.

Never run model-generated verification commands. The primary agent reviews the candidate and runs separately authorized project checks. Generation does not imply syntax validity, correct behavior, passing tests, or safe dependencies. Preserve all unrelated worktree changes.

## 11. Configuration and trust

Proposed user configuration: `~/.config/offload/config.json`; state/cache under platform-appropriate user directories. An optional repository `.offload.json` can choose permitted task defaults, not widen trust.

Separate immutable security ceilings from overrideable preferences. CLI flags, environment variables, or repository config must not silently weaken a user-level deny policy. Resolve relative paths against the configuration's documented root and display effective settings with provenance in `doctor`.

Suggested schema fields:

```json
{
  "schemaVersion": 1,
  "provider": {
    "type": "claude-cli",
    "executable": "claude"
  },
  "privacy": { "authorizedWorkerProfiles": [] },
  "worker": { "policy": "snapshot-only", "maxDepth": 1 },
  "routing": { "mode": "suggest", "minLines": 350, "minBytes": 24576 },
  "limits": {
    "maxFiles": 20,
    "maxFileBytes": 262144,
    "maxCorpusBytes": 524288,
    "maxOutputTokens": 1200,
    "maxResultBytes": 16384,
    "timeoutSeconds": 120
  },
  "generation": { "applyByDefault": false },
  "cache": { "enabled": false }
}
```

This example is deliberately not authorized for inference yet. `init` records a user-approved worker profile after explaining its destination and detecting the CLI. A Codex profile uses `codex-cli` and executable `codex`. Resolve any omitted model through the CLI's supported configuration, show it where available, and require an appropriate context estimate. Do not ask for Ollama or a new API key when the selected CLI's existing authentication works.

## 12. Agent integrations

### Generic instructions: MVP

Provide separate short snippets users can add to `CLAUDE.md` and `AGENTS.md`, preserving existing content. Both use the same wrapper commands. Tell the primary agent to delegate broad source questions and repetitive generation, use bounded source reads for exact edits, and retain responsibility for final reasoning. The host and worker are independent choices: either main agent can invoke either available supported worker adapter. A new worker receives no parent conversation history. If the host cannot launch local subprocesses, state that limitation; a document alone does not add tools to a web chat.

Include a minimal usage instruction: before a broad source read, ask `offload read` a specific question about explicit paths; inspect its cited findings; use exact targeted source reads for edits. Use `generate` for predictable candidates only. Do not delegate again from a worker session.

### Claude Code: optional later hook adapter

Implement a fast `PreToolUse` Read adapter using the current official schema. Do not copy Shunt's hook output uncritically. Support `off`, `suggest`, and opt-in `enforce` modes. Default to suggest. Only large unbounded reads are candidates; bounded reads within configured range limits proceed.

The hook checks inexpensive local policy and file metadata; it never invokes inference. In enforce mode, explain the alternative CLI call and the bounded-read escape hatch. Avoid recursive interception of delegate-owned operations. Provider failures must not trap the user in repeated blocks: document disabling routing and a narrowly scoped explicit bypass. Routing is an efficiency aid, not a confidentiality control, and must not override host permission denials.

Installation is explicit. Preview changes, preserve existing settings/hooks, back up modified configuration, and support uninstall of only this tool's entries. Detect unsupported host schema/version and leave existing configuration untouched.

Do not add Bash interception in MVP. Shell strings, pipes, compound commands, quoting, and redirection make simplistic parsing unreliable. Any future Bash adapter must be conservative, separately tested, and described as best-effort.

Official reference: [Claude Code hooks](https://code.claude.com/docs/en/hooks).

### MCP: later portability layer

Expose the same read/generate operations through a stdio server for compatible hosts. Keep stdout protocol-only and diagnostics on stderr. Fix the allowed workspace at startup rather than accepting arbitrary client-provided roots. Apply exactly the same policy as the CLI.

MCP exposes tools; it does not force the host to use them or intercept its existing Read tool. Do not claim equivalent hooks exist in every coding agent. Verify each target host's current integration capabilities before adding instructions.

Official reference: [MCP server development](https://modelcontextprotocol.io/docs/develop/build-server).

## 13. Optional cache and observability

Add only after the uncached flow works. Cache analysis, not generation, initially. Key by workspace identity, ordered snapshot hashes/ranges, exact question, provider endpoint identity, model identity/version when available, task/prompt version, schema version, and inference settings. If model revision is opaque, use expiry and explicit invalidation; a mutable model tag is not a stable identity.

Recheck current file policy before serving a cache hit. A newly excluded file must not leak through old results. Keep entries private, bounded by age/size, and inspectable/deletable. Cached summaries may contain proprietary source details. No raw source bodies by default. Use atomic entry creation to avoid corrupt concurrent writes.

Measure source bytes, estimated primary-context input avoided, returned-result bytes/tokens, worker input/output tokens when known, wall time, cache hits, and outcome. Label estimates as estimates. Do not describe worker delegation as free or promise a particular percentage saving; main-agent token reduction is different from total inference cost and end-to-end task time.

## 14. Test plan and acceptance criteria

Default test suite is offline and deterministic using synthetic fixtures and fake CLI executables. Later HTTP adapters add mock HTTP tests. Real-model tests are an explicit separate command, never required for normal CI.

Required automated cases:

- Paths with spaces, Unicode, relative traversal, sibling-prefix traps, and symlink escapes.
- Excluded files supplied explicitly, directories, binary files, oversized files, missing files, and non-Git roots.
- Corpus/context overflow rejected before a provider call.
- Valid findings, nonexistent source IDs, invalid ranges, mismatched quotes, malformed JSON, and truncated output.
- CLI missing, unsupported version, missing login, unavailable model, usage limit, timeout, cancellation, malformed JSON/JSONL, partial output, and stderr contamination.
- Worker recursion blocked, nested-session restrictions surfaced, effective tool restrictions verified, and no orphan subprocesses.
- CLI configuration cannot activate unapproved tools/extensions or change the authorized destination silently.
- No provider/account fallback, no credentials/source text in wrapper logs, and injection fixtures cannot cause worker tool execution or repository mutations.
- Generate writes only to artifact storage; apply rejects stale references, changed targets, and unexpected existing files.
- Hook allow/suggest/enforce cases, current response schema, bounded reads, and unrelated settings preserved by installation/uninstall.
- Later cache invalidation on source, model, prompt, question, and policy changes.

MVP acceptance demo:

1. Run doctor against the selected installed Claude Code or Codex CLI; no Ollama process is installed or required.
2. Analyze two fixture files and return useful citations under the response cap.
3. Confirm the mock-recorded request contains only selected snapshots, not neighboring secrets.
4. Show a bounded exact source read remains possible.
5. Generate a test candidate; confirm tracked files have not changed.
6. Review and explicitly apply it to a new file.
7. Run the fixture project's tests as a separately approved development action.
8. Show actionable errors for missing login, unsupported worker policy, unavailable inference, and oversized input.
9. Repeat the same contract tests against the second CLI adapter without changing core task logic.

For model quality, curate at least ten answerable questions and several deliberately unanswerable ones. Score correctness, evidence, omissions, returned-context size, and latency. Evaluate generated code with actual fixture tests plus review. Report measurements, not only a token-saving headline.

## 15. Implementation milestones

### Phase 1 — standalone read MVP

Build schemas, configuration/trust split, file policy/snapshots, budgeting, fake CLI transport, read command, doctor, dry-run, and generic instruction snippets. Implement whichever CLI the user already has first, then the other adapter. Do not require both installed to use the tool. Validate effective worker restrictions before any real-source invocation. Exit gate: a working read demonstration through one supported CLI, adapter contract tests for both, and documented real smoke-test status for each.

### Phase 2 — candidate generation

Add multiple references, candidate artifact manifest, output validation, and safe new-file application. Exit gate: no tracked mutations until explicit apply; conflict tests pass.

### Phase 3 — agent experience

Refine the Claude Code and Codex primary-agent snippets; add optional Claude hooks, install preview/backup/uninstall, suggest-first routing, and end-to-end host checks. Exit gate: hook encourages delegation without blocking targeted work or modifying unrelated settings.

### Phase 4 — measured optimization

Add cache, stats, diff/log operations, and bounded chunking only as needed. Exit gate: benchmark reports show actual quality/latency/context tradeoffs and cache correctness.

### Phase 5 — Ollama and optional portability

Only now add Ollama/local inference. Preserve the same read/generate commands and output schema. MCP stdio and direct API adapters are optional separate extensions, not requirements for the first four phases. Exit gate: core tests remain unchanged across providers, and selecting local inference introduces no automatic cloud fallback.

## 16. Instructions to the implementing coding agent

Implement this brief incrementally. Begin with Phase 1; do not build later phases prematurely. First inspect the target repository, existing instructions, and available runtime. Present a short implementation plan and identify which of Claude Code and Codex is installed/authenticated, which is the primary agent, and which worker adapter can meet the execution policy. Verify dependency APIs and host hook schemas against current official documentation.

Use TypeScript for the core and avoid shell command construction. Keep workers tool-disabled or equivalently constrained under the verified policy in section 6; fail explicitly when unsupported. Reuse mock fixtures for repeatable tests. Do not install Ollama/models, add a separate API integration, switch accounts, change global agent configuration, apply candidate code, or publish packages without appropriate user authorization. Obtain authorization for the selected CLI worker's hosted inference during setup; do not silently enable other providers. Do not conceal missing features behind placeholders presented as finished behavior.

At each phase provide changed files, test results, a short runnable example, remaining limitations, and the next phase. Preserve the user's existing work. If using Shunt code rather than independently implementing these requirements, preserve applicable Apache-2.0 license and attribution notices.

## 17. Inspiration and sources

- [Spotify Shunt](https://github.com/spotify/portal-ai-plugins/tree/main/plugins/shunt): inspiration for separating host hooks, task guidance, and worker execution.
- [Shunt bulk-read implementation](https://github.com/spotify/portal-ai-plugins/blob/main/plugins/shunt/scripts/bulk-read): source corpus delegated outside primary context.
- [Shunt code-write implementation](https://github.com/spotify/portal-ai-plugins/blob/main/plugins/shunt/scripts/code-write): reference-based generation; this proposal changes the default to staged artifacts.
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference): initial Claude worker transport.
- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode): initial Codex worker transport.
- [Ollama chat API](https://docs.ollama.com/api/chat): later local-provider extension only.
- [Claude Code hooks](https://code.claude.com/docs/en/hooks): host adapter grounding.
- [MCP server development](https://modelcontextprotocol.io/docs/develop/build-server): optional tool integration grounding.

Everything beyond the cited existing APIs and Shunt behavior is a proposed design. No software was implemented, installed, or benchmarked as part of this brief.
