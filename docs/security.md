# Security and compatibility

Offload is local orchestration with hosted inference. It is not an OS security boundary against an adversary who can mutate your filesystem, replace executables, or change your account during a run. Source text, questions, model output, and repository settings are untrusted. Only user-selected files enter the prompt; providers receive already captured snapshots and never select files.

## Native delegation (default integration)

The user approved native subagents with inherited model selection in place of mandatory standalone snapshot-only isolation. Native preparation applies the same source path, secret, byte, and context checks. Its default context budget is 64,000 tokens; explicit library callers can lower it. Only metadata enters the parent response; the subagent reads a private packet and writes a bounded answer. Completion checks that the packet and original sources have not changed, validates coverage/ranges/quotes, and removes the job on success.

Native workers use the host's ordinary authentication, permissions, model defaults, tools, and administrative policy. They are not an Offload sandbox. Codex delegates through its native tools with no model/effort override. Claude's custom subagent uses `model: inherit`, Read/Write only, and omits CLAUDE.md loading. Tool instructions cannot guarantee that a native worker accesses only the packet or never writes another file; Offload does not verify native tool history or actual model identity. `modelSelection: inherit` describes the requested behavior, while actual model and usage remain null. Host overrides remain authoritative.

Native jobs temporarily persist source text in a mode-0700 system-temp directory with mode-0600 packet/state files. These are not durable caches. The prepared state hash is bound into the job directory name, so changing state and prompt together is detected without trusting another worker-writable file. Completion deletes known job files on success; failure leaves the packet until `discard`. The host must stop a failed, timed-out, cancelled, or abandoned worker before discarding. Crashes can leave jobs behind; there is no background sweeper. Cleanup refuses unexpected files and never recursively deletes an arbitrary path. These integrity checks detect packet replacement; they do not prevent a same-user process from deleting a job or changing source before completion.

The host enforces native concurrency, cancellation, and the instructed 120-second timeout. The CLI cannot terminate a subagent it did not launch. Source text reaches the host provider under its existing session usage; source exclusions do not restrict the host's other approved tools. Native instructions fall back to ordinary approved reads if delegation is unavailable.

## Standalone worker policy

The Claude adapter currently recognizes versions 2.1.268 and 2.1.278 and rechecks required flags before each read. It uses `-p --output-format json`, `--tools ""`, `--safe-mode`, `--restricted`, an empty strict MCP configuration, MCP tool denial, disabled slash commands/Chrome, no session persistence, and an explicit full model ID. It does not pass permission bypass flags, copy credentials, erase nesting markers, resume conversations, or automatically fall back.

The invocation runs from a fresh private OS temporary directory, receives snapshots over stdin, and inherits the CLI's ordinary login. This directory prevents incidental repository discovery but is not itself a sandbox. The documented CLI restrictions supply the tool boundary. Live restrictions have not yet been demonstrated against an authenticated model in this repository; offline tests exercise the invocation and parsing contract with fake executables.

Safe mode preserves organizational policy, and policy can include hooks. Offload therefore rejects known system policy locations, macOS managed-preference locations, cached remote policy, unidentifiable/Team/Enterprise accounts, and custom endpoint/auth/proxy/runtime-injection environments. Only identifiable first-party personal Pro/Max login profiles are currently supported. This deliberately excludes some valid installations until their policy can be verified. Do not remove organizational settings to make a worker run. Filesystem/account changes between checks remain outside the guarantee.

Codex 0.155.1 provides non-interactive JSONL and read-only sandboxing, but no verified contract here disables all tools, hooks, plugins, and incidental reads. The adapter diagnoses it and parses its response protocol in tests; all inference attempts fail with `WORKER_POLICY_UNSUPPORTED`. This is an explicit compatibility limitation, not a functioning live Codex worker.

Workers are spawned with argument arrays and `shell: false`. The POSIX process group is killed on cancellation, timeout, overflow, and leader exit, including descendants that hold inherited pipes. macOS and Linux are targeted; Windows execution is refused. An `OFFLOAD_WORKER` marker prevents accidental recursion but is not presented as a security boundary. Existing Claude nesting prohibitions remain in force.

## Files and data

Paths must stay within the canonical workspace, including resolved symlink targets. Symlinks into excluded paths are rejected. Reads check regular-file type, open without following a final symlink, compare file identity/metadata, read bounded bytes once, and recheck path identity. Traversal, directories, special files, missing files, duplicates, globs, invalid UTF-8, and binary control bytes are rejected. Files are not silently truncated.

Default exclusions cover Git metadata, dependency/build/cache directories, common credential stores, environment-secret files, keys, and Offload configuration. Even `.env.example` is denied in this release: trusted exceptions are not implemented yet. Content checks reject recognizable private keys and common token formats, but cannot detect every secret. Questions and selected text are still the caller's responsibility. No repository policy can broaden trust.

Standalone Offload does not persist source bodies or raw worker diagnostics; native mode uses the temporary packets described above. CLI-managed authentication, internal logs, transport telemetry, and provider-side retention are outside its control. Returning citations to the main coding agent also shares those excerpts with that agent's provider.

Explicit selections do not use `.gitignore`/`.delegateignore`; sensitive-file policy always applies. Recursive discovery and globbing are deferred, and will require both ignore sources. There is no whole-repository indexing or automatic upload.

## References inspected during implementation

- [Codex native subagents and model inheritance](https://developers.openai.com/codex/subagents/)
- [Claude native subagents and model inheritance](https://code.claude.com/docs/en/sub-agents)
- [Claude CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Claude managed settings](https://code.claude.com/docs/en/managed-settings)
- [Claude settings precedence](https://code.claude.com/docs/en/settings#exceptions-to-managed-settings-precedence)
- [Claude server-managed settings](https://code.claude.com/docs/en/server-managed-settings)
- [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive/)
- [Zod API](https://zod.dev/api)

Installed CLI `--help` output was also inspected. New versions require compatibility review and authorization rather than automatically inheriting a previously tested profile.
