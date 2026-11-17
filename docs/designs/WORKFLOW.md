# Design and documentation workflow

Public documentation describes supported behavior, interfaces and known limits.
Update the affected contract when implementation changes; resolve superseded text
instead of appending another dated decision. Keep session evidence, budgets and
runtime status in the ignored local handoff and reports.

For substantive architecture/state-protocol changes, use the repo-local
[design skill](../../.agents/skills/runscape-design/SKILL.md). Routine fixes need
focused tests and relevant documentation updates, not a full design lifecycle.
Review and implementation authorization remain distinct. Never claim independent
review or live verification without that evidence.

## Optional design tooling

The Elephant-Goldfish instruction bundle is a local development dependency, not
part of the game. Install the pinned revision only if the directory is absent:

```sh
git clone https://github.com/google/elephant-goldfish-model third_party/egm
git -C third_party/egm checkout b3a35956759bf7f024af2ff061b2e0b44b438e4c
```

Existing local installations can remain in place. The bundle is ignored by Git.
Read its own license and instructions when using it. The repo-local skill resolves
workflow paths relative to that directory. No global plugin install is required.

Start with the [feature template](templates/feature.md) when a design is needed.
Keep a review record only when it captures a lasting limitation or rationale;
transient review discussion belongs with the change. A spec or review does not
prove that a running process loaded the code.
