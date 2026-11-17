# Optional scheduled maintenance

`review.py` runs a separate Codex CLI review through a macOS LaunchAgent. It is
independent of the character planners and is not required to play. Installation
runs the CLI with full local access and no approval prompts; configure it only
with explicit operator authorization and an appropriately scoped local prompt.

Copy [the example](review-prompt.example.md) to `review-prompt.md` and adapt it to
the authorized instance. Create the local handoff from
[its template](../HANDOFF.example.md). Neither local file is tracked. Existing local
prompts and handoffs must be preserved when updating this repository.

```sh
python3 agents/maintenance/review.py install
python3 agents/maintenance/review.py status
python3 agents/maintenance/review.py pause
```

Use a Python interpreter with filesystem access to the repository. The installer
pins its resolved path. The LaunchAgent checks due time once per minute; first
review is due one hour after installation and subsequent reviews one hour after
the previous start. Missed hours are not replayed. An OS lock prevents overlapping
scheduled reviews, but does not lock out human sessions. Pause stops future work
and lets an in-flight review finish. Do not kill a review during runtime recovery.

`agents/runs/maintenance-reviews/` holds ignored schedules, reports, transcripts and
locks. Check fresh `last_tick_at`, completed report times and exit status; a loaded
job does not prove reviews are running. Failed reviews preserve the previous
evidence checkpoint. Scheduler failure is not a gameplay failure.

The example defaults to read-only when authorization is absent. Local fixes,
commits and reloads require explicit scope and appropriate checks. Reports stay
local. API spending limits and CLI account usage are separate.

Validation: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s agents/maintenance -p 'test_*.py'`.
`python3 agents/maintenance/review.py probe` performs a read-only CLI/auth/output
check; it does not review gameplay or commit changes.
