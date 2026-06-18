# Architecture

AI Workflow Observer separates local collection from enterprise analytics.

```text
Cursor / opencode / Copilot
        |
        v
Local Collector / MCP Server
        |
        v
Enterprise Ingestion API
        |
        v
Postgres / ClickHouse / Warehouse
        |
        v
Evaluation Workers
rules + skills + in-house model
        |
        v
BI / Reports
```

## Local Collector

The local collector runs on the member workstation. Its first adapter targets Cursor because Cursor is the current primary tool and the main migration baseline.

Responsibilities:

- Detect Cursor local storage roots.
- Inventory SQLite, JSON, and workspace storage candidates.
- Collect repository state from git.
- Emit normalized JSON events.
- Avoid depending on Cursor internal storage as a stable API.

## Cursor Adapter

The Cursor adapter treats Cursor storage as an unstable external dependency. It reports `observabilityLevel` so downstream analytics can separate complete data from partial or minimal observations.

Levels:

- `full`: complete agent-side events are available.
- `partial`: conversations or meaningful session data were extracted.
- `minimal`: storage and workspace signals were found, but conversations were not extracted.
- `none`: no Cursor storage was found.

## Evaluation Layer

The evaluation worker should use in-house models only for structure extraction:

- task type
- complexity
- correction events
- friction events
- outcome classification

Metrics should be computed by rules and statistics, not by asking the model for a single productivity score.

## Migration Reports

The main enterprise use case is Cursor to opencode migration analysis. Reports should compare task cohorts by type, complexity, repo, team, and time period.

Recommended conclusions:

- `safe_to_migrate`
- `hybrid_recommended`
- `needs_improvement`
- `cursor_dependent`
- `insufficient_data`
