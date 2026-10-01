<!-- offload:begin -->
## Source analysis with Offload

Use native delegation for broad source questions across explicitly known files. Keep planning, edits, review, and verification in the main agent. Use ordinary targeted reads for small inspections and exact source confirmation.

1. From the project root, prepare a bounded packet without printing its source contents into the main context:

   `rtk proxy ./.offload-local/offload prepare --host codex --question "A bounded source question" --paths explicit/files --json`

   For non-Git projects add `--root .`. Request JSON via `--request-file PATH|-` is also supported. Inspect the returned metadata only; do not read promptFile yourself.
2. Spawn one native subagent with no model or reasoning override and a fresh/minimal context (fork_turns="none" where supported). Do not choose a cheaper model or a specialized role with a different model. Host-level subagent defaults may override inheritance; if the host reports a different model, report it rather than claiming an exact match. Give it only result.workerInstruction from prepare. It reads the packet and writes result.answerFile. Never launch claude/codex CLI workers or run hosted init for this native workflow. Do not prompt the user for a separate worker model or login.
3. Wait for that worker before continuing dependent work. Allow at most one Offload worker at a time. Stop it after 120 seconds if unfinished; stop it before cleanup. If native delegation is unavailable, report that and use approved direct reads. Never silently switch providers or weaken host permissions.
4. Run `rtk proxy ./.offload-local/offload complete --job JOB --json` with the returned job path. Rely only on the validated result. Inspect coverage, omissions, unresolved questions, and citations; confirm relevant original lines before edits. Complete rejects changed sources and removes the packet on success.
5. On worker failure, timeout, cancellation, invalid evidence, or abandonment, stop the worker and run `rtk proxy ./.offload-local/offload discard --job JOB --json`. On BUDGET_EXCEEDED, narrow the question/files. Never silently retry or treat an unvalidated worker answer as evidence.

Native delegation uses this host's existing login, model-selection rules, and permissions. Offload validates selected files, budgets, hashes, and citations; it does not sandbox native tools or verify the worker's actual model/tool history. Host model defaults or administrative overrides remain in force. Usage is unknown unless reported by the host; do not claim cost savings from a shorter result alone.

Never delegate from an Offload worker. Never upload a whole repository or use Offload for file discovery. Temporary packets contain source text; complete/discard removes them. The launcher pins the installing Node runtime and built checkout; neither needs to be on PATH. Generation/application are not implemented.
<!-- offload:end -->
