# Hourly operations review

Authorized2026-10-29: user requests review in another hour, a recurring loop and automatic commits
of further optimizations. This enables a maintenance agent, not another gameplay controller.
No app scheduling tool is exposed in this session, so use macOS launchd and documented Codex CLI.

`agents/maintenance/review.py` manages one stable LaunchAgent label, a60s model-free due-time tick,
3600s interval and persisted operational state under ignored runs. First due install+3600s. Disabled
or early ticks do not invoke Codex. An exclusive OS lock prevents review overlap and releases on
exit; long reviews skip missed ticks instead of being killed during a save/reload. Separate control
lock preserves an operator pause during a running review. Failures keep the previous successful
start checkpoint; new reviews overlap it by5min and use event timestamps across live runs.

Each invocation loads the checked-in prompt, current git status, due review window and handoff.
Codex CLI uses saved local authentication/configured model without copying or printing credentials.
No new party model worker or game budget increase. Tests/fixes/local commits and graceful reloads
are authorized; role assignment, goal/account edits, publishing/pushing/merging and external messages
are outside scope. Unknown dirty source means read-only review. This is a prompt contract rather
than an OS capability restriction; local access is the user's existing never-approval/full-access
choice. Reports/CLI logs remain local. No automatic chat delivery or continuously active monitor
is claimed. Safety/save integrity and party supervision remain the existing layer responsibilities.

Alternatives: native app automation is preferable when its creation tool exists; no such tool is
available here. Keeping the conversation asleep for an hour is not durable scheduling. Cron would
also work but launchd is already the supported Mac supervision mechanism. A hosted worker cannot
inspect this private live local game/server state without another remote-access deployment.

Acceptance:7isolated Python tests cover early/paused ticks, process overlap, one due invocation,
success/failure checkpoints and pause during a review; read-only CLI probe verifies auth/report
output. Verify loaded launchd job, initial no-review tick, first due in one hour. Do not claim the
first maintenance run succeeded before it actually occurs. Documentation/source changes require
no party restart. Rollback/pause changes only future review scheduling, not gameplay state.

Focused fresh codebase-details/readiness review identified an install/tick race and zero-exit
missing-report checkpoint loss. Fixed by holding the review OS lock across installation and
requiring a nonempty report before success. Tests cover both, including a review starting before
its PID is written. Focused review plus author resolutions; no full five-stage/re-audit claim.

Host verification on2026-10-29: CLI probe/auth/report succeeded; launchd label loaded with first
due19:00:43UTC. Background Python's first script open is waiting for macOS Documents-folder
permission. Unified tccd logs show AUTHREQ_PROMPTING for SystemPolicyDocumentsFolder/Python. No
review has run. User must allow the OS prompt; no TCC setting was changed or bypass attempted.
Scheduled ticks record last_tick_at once the script is accessible. Party service remains untouched.
