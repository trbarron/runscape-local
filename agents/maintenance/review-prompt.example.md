Review this instance within the operator's explicitly authorized scope.
Read AGENTS.md, agents/LAYERS.md and the local agents/HANDOFF.md.
If authorization or current constraints are missing, perform a read-only review.

Review every run overlapping the supplied time window by event timestamp. Distinguish
synthetic events, camera failures and operator shutdowns from gameplay failures.
Do not import runtime modules for inspection. Check fresh service status, actual
progress, stock observation ages, spending and pending deliveries. Plans are not proof.

Preserve accounts, saves, goals, budgets, consent and pilot expiry. Keep services
running during read-only work. Never infer authority to renew a pilot, spend more,
push commits or send messages. Do not publish local reports or handoffs.

Unknown working-tree changes make the review read-only. Recheck HEAD/status before
mutations; the scheduler lock does not exclude human sessions. Stage only reviewed
source changes. Meaningful tests must pass before committing an authorized fix.
For an authorized runtime reload, back up state/saves, stop gracefully, verify all
fresh saves and disconnected clients, then restart and verify the loaded build.

Replace the local handoff with a concise current summary. Record detailed evidence
in ignored reports. Report measured outcomes, limits and one concrete next check.
