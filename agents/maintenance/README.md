# Hourly maintenance reviews

The user authorized an hourly review loop and automatic local commits of tested optimizations on
2026-10-29. This is an operations reviewer outside the running four-character party. It does not
replace the party's planners, promise continuous monitoring or change configured game budgets.

The macOS LaunchAgent `com.trb.runscape-rascals-review` checks a persisted due time once/minute.
The first review is due one hour after installation; later reviews are due one hour after the
previous start. Missed hours are not replayed in a burst. Runs hold an OS file lock so long reviews
skip overlapping ticks. Each review uses a fresh `codex exec` session with the existing CLI account
and configured model, full local access and no approval prompts as authorized. Keep the Mac on and
the user logged in; the Codex app need not stay open. The party already has independent supervision. macOS must grant this Python executable Documents
folder access to open this repository; Codex approval settings do not grant OS privacy permissions.
`last_tick_at` in status verifies that a scheduled tick actually reached the script.
Install with an interpreter that has repository access (the Homebrew Python below was verified
on2026-11-07); the installer pins its resolved executable. A loaded job or `enabled: true`
alone does not prove successful ticks. Check a fresh `last_tick_at` after installation.

```sh
/opt/homebrew/bin/python3 agents/maintenance/review.py install # Install/reschedule: first review one hour from now
python3 agents/maintenance/review.py status
python3 agents/maintenance/review.py pause   # Stops future reviews; lets any current review finish
```

Reports and execution logs are under ignored `agents/runs/maintenance-reviews/`:

- `schedule.json`: enabled flag, due time, last start/success/exit status and report path.
- `<timestamp>.md`: reviewer result; `<timestamp>.log`: CLI transcript/errors.
- `scheduler.log`: launchd/script diagnostics; `probe.md`/`probe.log`: CLI setup check only.
- `review.lock` prevents overlap; `control.lock` protects pause/finish bookkeeping. OS locks release
  on process exit. A failure preserves the previous evidence checkpoint, so the next review covers
  the missed window. Check exit status/logs rather than treating process start as success.

The versioned [review prompt](review-prompt.md) requires timestamp-based live-run identification,
actual outcomes rather than promises, appropriate tests before local commits, and verified graceful
save/reload for runtime fixes. No change quota, pushes/merges, external messaging or goal/account
edits. Unfamiliar working-tree changes force read-only review; known pre-existing files are preserved.
A scheduler lock cannot lock out independent human sessions: the reviewer must recheck HEAD/status
before mutations and stop on conflicts. No code fix is automatically trusted merely because a model
made it. Review limitations and pending live verification remain explicit in the handoff/report.

The scheduler doesn't kill a review at the next hour or during deployment. Pause first; an in-flight
review finishes safely. Installation refuses a recorded live review PID. Do not unload/kill a job
in the middle of a runtime restart. Failed scheduler/bootstrap/auth tasks do not imply a gameplay
failure; the party continues under its own service. Reports are local, not automatically posted to
this conversation. CLI usage is separate from the party's configured API spending ledger.

Implementation uses the documented [Codex noninteractive CLI](https://learn.chatgpt.com/docs/non-interactive-mode).
Validation: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s agents/maintenance -p 'test_*.py'`.
`python3 agents/maintenance/review.py probe` performs one read-only CLI/auth/report-output check;
it does not run a maintenance review, change the party or commit anything.
