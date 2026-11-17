# Scheduled maintenance contract

The optional scheduler is separate from gameplay and requires explicit instance
configuration. See [setup and permissions](../../agents/maintenance/README.md).

A minute tick checks the persisted due time. Reviews are due one hour after the
previous start; missed intervals are not replayed. OS locking serializes scheduler
runs, not concurrent human work. A failed review retains the prior evidence cutoff.
Pause prevents future starts while allowing current work to finish safely.

Review all runs overlapping the evidence window by event timestamp. Unknown dirty
work makes review read-only. Keep reports and active operator prompts local. Source
fixes, commits and reloads require the operator's scope, appropriate checks and the
existing backup/graceful-save protocol. The scheduler never establishes gameplay
progress merely by running and public examples confer no deployment authorization.

`agents/maintenance/test_review.py` covers scheduling and process behavior. Verify
fresh ticks, completed reports and exit status on an installed instance.
