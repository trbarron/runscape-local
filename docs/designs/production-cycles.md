# Own-stock bounded production cycles

Authorized2026-10-29: user approved batch-finished vs supplies-exhausted reporting, bounded
bank→withdraw→produce→bank continuation, own-stock vs external shortage, and intermediate-input
suppression. Baseline5c7a186 plus documentation. Current proof:540coal actually delivered; Mike
still has468coal/337ore but switches to bronze after two-ore carried batches. No new mission chosen.

## Contract

A chosen routine with only own-bank withdrawals/deposits/equipment and supported exact production
(smelt/smith/cook/craft/fletch/firemake), at least one production step, a final bank step, and all
production stop types exhausted may continue its same pipeline across carried batches. Do not
extend explicit gathered/time/skill-level production quotas or include give/travel/buy/rest/combat.
Do not change targets/methods/roles. Explicit repeat routines retain their chosen repeat semantics.
Auto continuation needs a successful productive lap, fresh game state, a bank view<=30min old,
verified bank-owned raw/intermediate inputs for at least one complete recipe unit, and the existing30min invocation
budget. Check before each step and clip executor pass deadlines to remaining cycle time. No automatic donation or new raw-material purchase to extend the cycle. Stop on unknown
stock, depletion, readiness failure, no progress, or existing goal/council interruptions and shutdown. The
existing executor checks actual usable inputs on every step. Counts conservatively exclude carried forms (including ambiguous single notes) from continuation proof.
The report still shows observed carried counts, with form rechecked by readiness. Capacity recursively
accounts for downstream ratios and existing banked intermediates; values cap2000, explicitly labelled
“at least” at the cap. Counts are estimated input capacity,
not guaranteed outputs (iron impurity losses still apply). Existing restart behavior resets the
invocation timer; document this, do not claim a durable across-restart deadline.

Compute recipe external inputs by removing supported intermediate outputs from earlier own pipeline
steps. Use same helper for supply-context dependency checks, including full repeating/resumed
pipeline provenance. A bar can also be internally replenished when this character has a supported
smelting recipe and observed owned raw inputs; show its upstream inputs instead of an external-bar
request. No production is executed by this advisor. Zero upstream capacity is a real prerequisite
shortage; do not count planned outputs as present bars. Unknown alternatives remain unknown.

At exhausted productive step end, append explicit “carried batch finished” own-stock report from
fresh dated bank facts. Reports enumerate limiting external inputs, distinguish owned bank stock
from carried stock, and say whether next action is own-bank preparation, verification, or sourcing.
Attach typed additive productionBatch metadata to order_end; do not rewrite old observations or
count the report as achievement. Routine continuation logs explain executor-managed cycling rather
than pretending the model requested repeat. Recompute on resume, using existing routine steps; no
new persisted schema is required. Ordinary explicit repeat remains model-owned.

Automatic banking includes exact named output items for the chosen supported routine; keep unrelated
carried gear/tools and food reserve. Explicit bank targets retain their meaning. Existing readiness
may clear safe surplus; a failure to make space must end/replan, not loop. Tests must demonstrate
capacity checks, fixed quotas, stale/missing observations, notes not considered usable inventory,
pipeline intermediates, loop stop/progress/budget/interruption and actual own-bank continuation.

## Alternatives and limits

Prompt-only encouragement leaves per-batch replanning and ambiguous depletion messages. Extending
one smelt step across all owned stock can bank all bars before smithing and distort the pipeline.
Bounded repetition of the character's chosen pipeline preserves recipe load ratios and downstream
work. A new generic production action/queue would require broader planner/schema migration; not
needed. No extra model calls, website schema, goal edits or account/save edits. Pure helper plus
agent loop/report and supply-context integration; existing graceful backup/save/reload deployment.
Success: observe at least two own-bank batches in one chosen pipeline, with bank materials decreasing,
outputs banked and no spurious external-bar request; report tests vs actual live evidence separately.
Review is focused critic/readiness, not a full five-stage lifecycle or automatic human approval.

## Focused review and resolutions

Fresh production_cycle_review read the design-critic persona and implementation-readiness standard
plus selected source. Findings: downstream bar ratios, output cleanup coverage, unsupported fletch
aliases and single-note ambiguity. Resolved with recursive bank-stock recipe capacity, backwards
input counts, supported exact output mapping, craft/fletch cleanup and bank-only continuation proof.
No inventory note is silently declared usable. No formal full five-stage review/approval claim.
Real-loop fixtures inject memory writes, bank views and clock; no fixture touches live state.
Explicit repeat flag is not rewritten: executor continuation is logged as such and recomputed on
resume. Existing controller goal/council interrupts stop the cycle; there is no new goal selector.

Focused integration recheck found explicit-repeat gates, speculative upstream demand from existing
bars, unordered intermediate suppression and capacity that could skip the selected first producer.
Resolved: executor cycling only when original repeat=false; synthetic upstream needs raw-only bank
proof, not bars; suppression stays within ordered source provenance; capacity simulates preserved
step order with minimum work at every producer plus downstream ratios/intermediate credit. Tests
cover smith-only banked bars, smith-before-smelt and explicit repeat. Bank timestamps and intermediate
counts remain in batch metadata, also retained within the existing bounded field-guide facts.

## Concise reporting follow-up (2026-10-29)

User requested less token-heavy structured log/context reporting. Normal exhausted-batch prose
now replaces pack-empty/all-party bank digressions with one short own-bank next-step statement.
Smelting output uses confirmed bars once, consumed inputs once, and mentions impurity/reach failures
only when present. Typed smelting/productionBatch counters and bank timestamps remain intact.
Model-facing field-guide projection compacts old/new valid facts into XP, duration, measured output/
inputs, failures, own-bank capacity and relevant movement. Stored observations are immutable;
malformed/unknown formats fall back to original text. Tests retain loss/reach counts and bank
evidence while checking repeated bar text and material context size reduction. Runtime behavior,
readiness, supply logic and snapshot schema are unchanged.
