# Runscape maintenance guidance

EGM artifact directory: docs/designs

This repository runs a persistent four-character party. The game and its character planners
are independent of the coding assistant reviewing them. Read [the layer contract](agents/LAYERS.md)
and [the current handoff](agents/HANDOFF.md) before changing runtime behavior or live state.
`AGENTS.md` points to this file so tools using either convention receive the same guidance.

- Use `agents/README.md` for startup, configuration and source locations. The layer contract
  explains who owns a decision; the handoff records what is currently deployed and pending.
- Review all runs overlapping the requested time window, using event timestamps. Tests can
  create run directories and emit `party` events; the newest directory is not necessarily live.
  Separate synthetic events, operator shutdowns and camera errors from gameplay failures.
- Fix feasibility, recovery and coordination in code. Character preferences and division of
  labor belong to the characters within the user's constraints. Do not silently replace a
  user goal with a convenient template or count prose claims as game-verified outcomes.
- An edit on disk does not reload a running orchestrator. Distinguish implemented, tested,
  loaded locally, deployed and verified. Runtime state edits, when needed for the task, need
  a backup and a clear explanation. Preserve accounts, saves and unrelated session changes.
- Keep the party running during read-only review and documentation work. When a restart is
  necessary, use the existing graceful shutdown and verify character saves before relaunch.
- Website work belongs in the `tyler-barron-dot-com` repository; read its own guidance. Shared
  snapshot/asset contract changes require producer and consumer verification. The website is
  an observer, not a second agent controller.
- Run checks appropriate to code changes. Do not import runtime modules just to inspect data:
  imports can create logs or load/persist live state. Documentation edits need link and fact
  checks, not a party restart or a broad runtime test run.
- At a session boundary update `agents/HANDOFF.md`: evidence window, current runtime/commit,
  changes actually loaded, remaining work and one concrete next verification. Never put
  credentials or account passwords in documentation.

For explicit specs and substantive architecture/state-protocol changes, use the repo-local
[runscape-design skill](.agents/skills/runscape-design/SKILL.md) and [design index](docs/designs/SITEMAP.md).
The pinned EGM bundle lives in `third_party/egm`. Keep observed baselines separate from proposed
requirements, use fresh read-only reviewers when that workflow calls for them, and preserve actual
user authorization. Routine bug fixes do not require the full design lifecycle. Do not claim a
formal review or human approval just because an artifact was created.
