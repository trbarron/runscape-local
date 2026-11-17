# Runscape design workflow

This is the repository binding for Google's [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model).
The upstream instruction bundle is checked in at [third_party/egm](../../third_party/egm/README.md),
pinned by [UPSTREAM.json](../../third_party/egm/UPSTREAM.json), with its Apache-2.0 license retained.
No global plugin configuration, game runtime or model routing is changed by this integration.

## Entry points

Ask a compatible coding agent to use `$runscape-design`, or point any tool at
[the local skill](../../.agents/skills/runscape-design/SKILL.md). It loads the contracts and routes
into the relevant pinned upstream skill. Native discovery may require a new session. The shared
root guidance is readable as `AGENT.md`, `AGENTS.md`, or `CLAUDE.md`; Claude's project skill path
links to the same local entry. Direct file invocation works without global installation.

Examples:

- “Use runscape-design to draft acknowledged item-delivery coordination.”
- “Review docs/designs/my-feature.md using fresh Goldfish contexts.”
- “Compare the mission-coordination spec with current source; report drift without fixing it.”

This is a repo-local context binding, not a claim that native `/egm:*` commands were globally
installed. To install the native plugin in a particular app, follow the pinned host guide or
[upstream setup](https://github.com/google/elephant-goldfish-model/blob/main/docs/harnesses.md).
The local copies include the necessary personas and standards, not only loose skill entry files.

## Working states

| State | Meaning |
|---|---|
| Observed baseline | Describes inspected code at a recorded commit; does not certify that the behavior is ideal |
| Draft proposal | A future behavior change, with alternatives and an explicit scope |
| Independently reviewed | Actual fresh reviewers completed the recorded checks; unresolved findings remain visible |
| Implementation-ready | Interfaces, decisions, acceptance checks and rollout are concrete enough to implement |
| Authorized | The user has authorized this implementation scope; record the actual instruction, never infer approval from a file label |
| Implemented / loaded / verified | Separate code, deployment and evidence milestones; a commit is not a running build |

A reviewed baseline is not automatically a lossless reimplementation specification. Do not treat
recorded limitations as approved desired behavior. A source hash anchors the observation, not its
correctness. Tests, source review and user judgment remain distinct evidence.

## Scope and artifacts

[SITEMAP.md](SITEMAP.md) is the index. High-level source contracts are `EGM.md` files beside their
packages. Detailed behavior specs live here. Start a new feature from
[the feature template](templates/feature.md), retain review evidence with
[the review template](templates/review.md), and keep operational observations in
[the maintenance handoff](../../agents/HANDOFF.md).

For the initial bootstrap, the source scope is `agents` plus root orchestration/configuration:
core, portraits, world index and map. Existing READMEs are preserved. `.egmignore` excludes the SDK,
saves, credentials, state, runs, public outputs, dependencies, docs and vendored tooling. Discovery
is incremental, not an unbounded recursive inspection of the checkout. The first-party source
packages fit the upstream direct-execution scope; a full SDK bootstrap is a different task.

## Design and review

For substantive changes, first describe the problem and write a concrete design without changing
runtime behavior. Resolve choices in the document rather than relying on earlier chat. The spec
should include observable contracts, failure handling, side effects, migration and bounded live
verification. Keep reviews proportional; a two-line bug fix does not need a new architecture process.

Use the pinned upstream draft/review modes when their formal lifecycle is requested. Review stages
must be labeled honestly: comprehension, antagonistic review and readiness are different checks.
Send a fresh reviewer only the target, relevant standard/persona and an explicit source reading list.
Use the host's fresh-context parameter, never a copied parent transcript or prior answers. A source
scout is useful evidence, but is not an independent review of a document that did not yet exist.
Record tool completion and reading limits, not just a parent-written claim of success.

Upstream approval gates belong to the invoked mode. Existing user authorization still takes
precedence. Retrospective documentation needs no new game deployment. A new proposal's review does
not itself authorize runtime changes, and an implementation request does not silently authorize
unrelated proposals. If a gate prevents authorized work, name the exact instruction and explain it.

## Implementation and maintenance

Implement only authorized behavior, using the spec's acceptance criteria. Run focused checks first;
expand when changes or failures justify it. Preserve the existing graceful-save restart contract.
Record exact loaded code and the actual observation window in the handoff. Do not re-import runtime
modules just to collect documentation: imports can create logs and load/persist state.

After a substantive change, update the affected spec and source contract in the same work. Record
new unknowns as findings rather than inventing guarantees. A weekly drift review is a useful
maintenance practice, but this integration creates no scheduled task or background reviewer.
