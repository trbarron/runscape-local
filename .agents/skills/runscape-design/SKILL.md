---
name: runscape-design
description: Load Runscape architecture contracts and use the pinned Elephant-Goldfish workflows for reverse-specification, substantial design work, independent spec review, or drift checks. Use for explicit spec work and changes to architecture or state protocols; routine bug fixes use the normal coding workflow.
---

# Runscape design context

Repository root is three parents above this skill directory. Resolve it before using the paths below.
Read `AGENT.md`, `docs/designs/SITEMAP.md`, the relevant accepted/observed contract, and
`agents/HANDOFF.md`. A handoff is dated operational evidence, not the specification.

The complete instruction/persona/standards bundle is pinned at `third_party/egm`; provenance and
hashes are in `UPSTREAM.json`. This repo-local binding does not install a global plugin. Use that
canonical directory as the plugin root when upstream instructions refer to a plugin root or
`${CLAUDE_PLUGIN_ROOT}`; read its host guide for the available harness. Never guess cache paths.

Use only the relevant upstream mode:

- Existing-code contracts: `third_party/egm/skills/egm_bootstrap/SKILL.md`. Target `EGM.md` so
  existing READMEs survive. Scope to first-party source; honor `.egmignore` and the actual skill's
  discovery limits. Exclude credentials, live state, saves, logs, generated assets and the SDK clone.
- Explore a new substantive design: `skills/egm_brainstorm/SKILL.md` under that plugin root.
- Draft a feature spec: `skills/egm_draft/SKILL.md`; use `docs/designs/templates/feature.md` for
  repo-specific evidence and rollout fields while retaining the upstream standards and gates.
- Review a concrete draft: `skills/egm_review/SKILL.md` or `skills/egm_review_loop/SKILL.md`.
- Resolve findings: `skills/egm_resolve/SKILL.md`.
- Compare documentation to code: `skills/egm_drift_report/SKILL.md`.

Fresh reviewers must receive the document, selected source references, persona and standard, with
no parent conversation. With this harness use `fork_turns: "none"` (or the actual equivalent on
another host). Read-only reviewers must not import runtime modules, alter state or restart services.
Respect the host's concurrency limit; an upstream request for unbounded workers cannot override it.
If fresh contexts are unavailable, record that limitation rather than claiming independent review.

Keep observed behavior, intended requirements, known defects and proposed improvements separate.
Do not turn a retrospective spec into permission to implement everything it mentions. Carry existing
user authorization forward; never fabricate human approval or a completed review stage. Record
findings and decisions, then implement only the scope actually authorized by the user.

Artifacts go under `docs/designs/`. Keep `SITEMAP.md` and the relevant source contracts current.
For small clear bug fixes, patch/test normally and update affected contracts only when behavior changes.
