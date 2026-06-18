# Metrics

The first metric layer measures workflow friction, not model intelligence.

## Core Metrics

- `taskCount`: number of task-like conversations.
- `messageCount`: total raw Cursor bubbles/messages. Use this for audit/debugging.
- `turnCount`: logical user/assistant turns after merging consecutive same-role raw messages. Use this for BI.
- `completionRate`: completed tasks divided by all tasks.
- `correctionCount`: detected user correction events.
- `frictionEventCount`: detected workflow friction events.
- `averageCorrectionsPerTask`: correction density.
- `averageUserTurnsPerTask`: primary user interaction cost.
- `averageAssistantTurnsPerTask`: primary agent response cycle cost.
- `averageUserMessagesPerTask`: raw user message cost for audit/debugging.
- `averageAssistantMessagesPerTask`: raw assistant message cost for audit/debugging.

## Data Layers

- `rawMessages`: source-level messages or Cursor bubbles.
- `turns`: consecutive same-role raw messages merged into user-visible turns.
- `tasks`: task candidates derived from conversations/composers.

## Correction Types

- `clarification`
- `preference_adjustment`
- `scope_change`
- `error_correction`
- `misinterpretation`
- `missed_requirement`
- `execution_failure`
- `quality_feedback`

## Friction Types

- `correction`
- `rework`
- `tool_failure`
- `long_iteration`
- `abandonment`
- `low_signal_exchange`

## Interpretation

For migration analysis, compare cohorts by tool, team, repo, task type, complexity, and time period. Do not compare raw averages across unmatched task populations.
