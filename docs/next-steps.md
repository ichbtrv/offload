# Next steps: native Codex and Claude use

The user approved native delegation with inherited model selection and existing session login. This replaces the earlier recommendation to configure Codex → standalone Claude as the default.

## Implemented

- `prepare` captures explicit source snapshots, applies existing file/budget checks, and returns a private packet path plus metadata without source bodies.
- The current host launches a native subagent. Codex instructions request no model/effort override; the Claude definition sets `model: inherit`.
- `complete` checks the packet, unchanged source hashes, coverage, ranges, quotes, and result size; success removes the packet. `discard` cleans up a stopped/abandoned worker job.
- Project-local installation covers AGENTS.md, CLAUDE.md, the Claude subagent definition, and a Node-pinned launcher. Existing instructions are preserved. Both integrations are installed in this checkout.
- Two live Codex native fixture tasks passed: answerable expiration behavior and an unanswerable database/retention question. Claude 2.1.278 validates the custom subagent definition. See verification.md for precise evidence and limits.

## Next acceptance work

1. Start a fresh Claude Code session in this checkout and ask a broad bounded source question. Confirm it chooses offload-reader, inherits the current model, writes answer.json, and invokes complete. Do not run standalone init or ask for a separate worker login/model.
2. Repeat from a fresh Codex session to verify spontaneous adoption from installed instructions, rather than an explicit smoke-test request.
3. Observe cancellation and timeout behavior in each host. The CLI cannot stop a native agent; the host must stop it before discard. Check cleanup after failure and clear reporting of unavailable delegation.
4. Broaden quality evaluation to at least ten answerable and several unanswerable questions. Record correctness, omissions, latency, result size, and actual usage where observable. Smaller parent context alone does not prove total cost savings.
5. If the user wants other repositories, run integrate with those explicit project roots. Current installation is local to this checkout; no global setup occurred.

## Boundaries

Native workers follow host permissions. Offload does not claim strict snapshot-only isolation or verify native tool history/actual model identity. Host defaults and administrative overrides may change native model selection. Temporary packets contain source text until completion/discard; crashes can leave them behind.

The original standalone read/init/doctor route remains opt-in. Its Codex worker isolation is still unsupported; standalone Claude nesting remains rejected. Those restrictions do not apply to native host delegation. Claude Pro login was confirmed outside the Codex sandbox; repeated sandbox login failures do not mean the user needs to log in again.

Generation/application, caching, hooks, MCP, and Ollama remain later work. Preserve existing uncommitted changes and follow repository RTK instructions.
