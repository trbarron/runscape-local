# Runscape maintenance guidance

EGM artifact directory: docs/designs

Read [layer ownership](agents/LAYERS.md) before changing runtime behavior. For an
operated instance also read the ignored `agents/HANDOFF.md`; create it from
[the template](agents/HANDOFF.example.md) when setting up a new instance. Missing
local context is not permission to change existing accounts, goals or live state.

- Use [the party README](agents/README.md) for configuration and source locations.
- Review all runs overlapping a requested window by event timestamps. Synthetic
  tests, camera failures and operator shutdowns are distinct from gameplay failure.
- Fix feasibility and recovery in code. Characters own preferences and work splits
  within user constraints. Plans and prose are not game-verified outcomes.
- Keep services running during read-only work. Runtime reloads require a state/save
  backup, graceful shutdown, verified fresh saves and verification after relaunch.
- Distinguish implemented, tested, loaded and verified. Preserve accounts, saves
  and unrelated work. Never import runtime modules merely to inspect data.
- Website consumers are observers. Shared publication changes need producer and
  consumer checks in their respective repositories.
- At session boundaries replace the local handoff with current facts and one next
  verification; keep detailed history in ignored reports. Never record credentials.
- Public docs track supported behavior and limitations, not session chronology.
  Check links against the tracked tree. Do not publish local handoffs, model
  overrides, operational prompts, scorecard history, state or logs.

For explicit specs and substantive architecture/state-protocol changes use the
[design skill](.agents/skills/runscape-design/SKILL.md) and
[workflow](docs/designs/WORKFLOW.md). Install its optional pinned bundle before use.
