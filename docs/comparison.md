# Tool and Model Comparison

AI Workflow Observer compares workflow friction across cohorts. It should not be presented as a direct model benchmark.

## Required Cohort Fields

Collector runs include a `context` object:

```json
{
  "sourceTool": "cursor",
  "toolVersion": "0.50.0",
  "modelProvider": "anthropic",
  "modelName": "claude-sonnet",
  "modelVersion": "2026-06",
  "teamId": "backend",
  "repoId": "repo-analytics-api",
  "experimentId": "cursor-to-opencode-2026q3",
  "migrationCohort": "cursor-baseline"
}
```

Use stable pseudonymous ids for `teamId` and `repoId` if organization names are sensitive.

## Recommended Comparison

Compare matched cohorts only:

- same department
- same team
- same repo group
- same task type
- same complexity
- same time window

Do not compare all Cursor tasks against all opencode tasks without matching task mix.

## Useful Metrics

- `completionRate`
- `averageUserTurnsPerTask`
- `averageCorrectionsPerTask`
- `frictionEventCount / taskCount`
- `abandonmentRate`
- `longIterationRate`

## Decision Labels

- `safe_to_migrate`
- `hybrid_recommended`
- `needs_improvement`
- `cursor_dependent`
- `insufficient_data`

## Example Query Shape

```sql
select
  source_tool,
  model_provider,
  model_name,
  migration_cohort,
  task_type,
  complexity,
  count(*) as task_count,
  avg(user_turn_count) as avg_user_turns,
  avg(correction_count) as avg_corrections,
  avg(friction_event_count) as avg_friction_events,
  avg(case when outcome = 'completed' then 1 else 0 end) as completion_rate
from task_summaries
where started_at >= now() - interval '30 days'
group by source_tool, model_provider, model_name, migration_cohort, task_type, complexity
order by task_count desc;
```
