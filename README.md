# AI Workflow Observer

Privacy-first observability for real-world AI coding workflows.

AI Workflow Observer helps teams understand whether AI coding tools are actually reducing workflow friction. It collects local usage signals from tools such as Cursor, normalizes them into tasks, turns, corrections, and friction events, and uploads privacy-controlled metrics for team-level analysis.

It is not a model benchmark and it is not an employee ranking system.

## Why

Enterprise AI productivity is often measured with surveys and rough estimates. Those signals are weak when teams are changing tools, models, prompts, or internal agents.

AI Workflow Observer focuses on real usage:

- How many user turns did a task need?
- How often did users correct the AI?
- Which task types create more friction?
- Did a tool or model migration make work smoother or harder?
- Which departments or cohorts are ready for migration?

The first target use case is comparing Cursor usage against an opencode or in-house model rollout.

## What It Measures

The system separates three layers:

- `rawMessages`: source-level messages or Cursor bubbles for audit/debugging.
- `turns`: consecutive same-role messages merged into user-visible turns.
- `tasks`: task candidates derived from conversations or composers.

Core metrics include:

- `completionRate`
- `averageUserTurnsPerTask`
- `averageAssistantTurnsPerTask`
- `averageCorrectionsPerTask`
- `frictionEventCount`
- `taskType`
- `complexity`
- `departmentId`
- `sourceTool`
- `modelName`
- `migrationCohort`

## Architecture

```text
Cursor / opencode / Copilot
        |
        v
Local collector
        |
        v
Privacy filter
        |
        v
Ingestion API
        |
        v
JSONL today, Postgres/ClickHouse later
        |
        v
BI / migration reports
```

Current packages:

- `apps/collector-cli`: local collector and uploader.
- `apps/ingestion-api`: minimal private ingestion API.
- `packages/cursor-adapter`: Cursor storage discovery and conversation extraction.
- `packages/evaluator`: task, turn, correction, and friction heuristics.
- `packages/git-adapter`: repository state collection.
- `packages/privacy`: redaction and hashing.
- `packages/schema`: shared data contracts.

## Current Status

This is an early POC. It already supports:

- Cursor local storage discovery.
- Cursor SQLite snapshot reading.
- Current Cursor `composerData` and `bubbleId` extraction.
- Raw message to logical turn merging.
- Heuristic task and correction detection.
- Department-key ingestion.
- Privacy modes for text and paths.
- Tool/model/team/repo cohort metadata.

It does not yet include:

- MCP server mode.
- Background daemon mode.
- Production database writer.
- In-house model evaluator worker.
- Full Cursor/Copilot/opencode adapter coverage.

## Quick Start

Install dependencies:

```sh
pnpm install
pnpm build
```

Run a local Cursor collection:

```sh
pnpm collector -- \
  --repo /path/to/repo \
  --python-sqlite-command python3 \
  --text-mode redacted \
  --path-mode basename \
  --no-raw-messages \
  --pretty \
  --output tmp-collector-run.json
```

On systems with the `sqlite3` CLI, this also works:

```sh
pnpm collector -- \
  --repo /path/to/repo \
  --sqlite-command sqlite3 \
  --text-mode redacted \
  --path-mode basename \
  --no-raw-messages \
  --pretty
```

## Privacy

Privacy is applied after local evaluation. This allows local task and friction extraction while reducing what leaves the employee machine.

Text modes:

```text
raw       Keep original text.
redacted  Replace text with length markers.
hash      Replace text with deterministic hashes and length.
```

Path modes:

```text
raw       Keep full paths.
basename  Keep only basename.
hash      Replace paths with deterministic hashes.
```

Recommended pilot defaults:

```sh
AWO_TEXT_MODE=redacted
AWO_PATH_MODE=basename
AWO_INCLUDE_RAW_MESSAGES=false
```

See [docs/privacy.md](docs/privacy.md).

## Ingestion

Start the ingestion API with department keys:

```sh
export AWO_DEPARTMENT_KEYS='engineering:eng_key,product:prd_key,design:dsn_key,data:data_key,ops:ops_key,support:sup_key'
PORT=3010 AWO_DATA_DIR=./data pnpm ingestion
```

Upload with `curl`:

```sh
curl -X POST http://127.0.0.1:3010/v1/collector-runs \
  -H 'content-type: application/json' \
  -H 'x-awo-department-key: eng_key' \
  --data-binary @tmp-collector-run.json
```

Or collect and upload directly:

```sh
pnpm collector -- \
  --repo /path/to/repo \
  --python-sqlite-command python3 \
  --text-mode redacted \
  --path-mode basename \
  --no-raw-messages \
  --source-tool cursor \
  --model-provider anthropic \
  --model-name claude-sonnet \
  --team-id backend \
  --repo-id repo-api \
  --migration-cohort cursor-baseline \
  --upload-url http://127.0.0.1:3010/v1/collector-runs \
  --department-key eng_key \
  --output tmp-collector-run.json
```

The server stores `departmentId` and `keyId`, not the raw department key.

See [docs/ingestion.md](docs/ingestion.md).

## Tool and Model Comparison

AI Workflow Observer compares matched workflow cohorts. It should not be used as a direct model benchmark.

Useful cohort fields:

- `sourceTool`
- `toolVersion`
- `modelProvider`
- `modelName`
- `modelVersion`
- `departmentId`
- `teamId`
- `repoId`
- `taskType`
- `complexity`
- `migrationCohort`

Compare matched cohorts by department, team, repository, task type, complexity, and time window.

See [docs/comparison.md](docs/comparison.md).

## Development

```sh
pnpm install
pnpm build
pnpm collector -- --repo . --python-sqlite-command python3 --text-mode redacted --path-mode basename --no-raw-messages --output tmp-collector-run.json
```

## Project Name

The recommended open-source name is **AI Workflow Observer**.

It is specific enough to describe the product, broad enough to support Cursor, opencode, Copilot, and future tools, and avoids implying a traditional model benchmark.

## License

MIT
