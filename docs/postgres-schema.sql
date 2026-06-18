create table if not exists collector_runs (
  run_id text primary key,
  schema_version text not null,
  generated_at timestamptz not null,
  received_at timestamptz not null default now(),
  member_id_hash text,
  department_id text,
  key_id text,
  source_tool text not null default 'cursor',
  tool_version text,
  model_provider text,
  model_name text,
  model_version text,
  team_id text,
  repo_id text,
  experiment_id text,
  migration_cohort text,
  observability_level text,
  raw jsonb not null
);

create table if not exists workflow_events (
  event_id text primary key,
  run_id text not null references collector_runs(run_id) on delete cascade,
  source text not null,
  event_type text not null,
  task_id text,
  workspace_id text,
  occurred_at timestamptz not null,
  payload jsonb not null
);

create index if not exists workflow_events_task_id_idx on workflow_events(task_id);
create index if not exists workflow_events_event_type_idx on workflow_events(event_type);
create index if not exists workflow_events_occurred_at_idx on workflow_events(occurred_at);

create table if not exists task_summaries (
  task_id text primary key,
  run_id text not null references collector_runs(run_id) on delete cascade,
  source text not null,
  source_conversation_id text,
  title text,
  task_type text not null,
  complexity text not null,
  outcome text not null,
  started_at timestamptz,
  ended_at timestamptz,
  message_count integer not null,
  turn_count integer not null,
  user_message_count integer not null,
  assistant_message_count integer not null,
  user_turn_count integer not null,
  assistant_turn_count integer not null,
  user_input_chars integer not null,
  assistant_output_chars integer not null,
  turns jsonb not null,
  correction_count integer not null,
  friction_event_count integer not null
);

create index if not exists task_summaries_task_type_idx on task_summaries(task_type);
create index if not exists task_summaries_outcome_idx on task_summaries(outcome);
create index if not exists task_summaries_started_at_idx on task_summaries(started_at);

create table if not exists task_evaluations (
  task_id text primary key references task_summaries(task_id) on delete cascade,
  run_id text not null references collector_runs(run_id) on delete cascade,
  evaluator text not null,
  evaluated_at timestamptz not null,
  confidence numeric not null,
  corrections jsonb not null,
  friction_events jsonb not null,
  notes jsonb not null
);
