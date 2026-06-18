# Schema Notes

The first schema version is `0.1`.

The top-level collector output is `CollectorRun`.

Important fields:

- `runId`: unique collector execution id.
- `memberIdHash`: optional SHA-256 hash of the member id.
- `cursor.observabilityLevel`: quality of Cursor-side visibility.
- `cursor.storageCandidates`: discovered local Cursor storage files and directories.
- `git`: repository state at collection time.
- `events`: normalized workflow events for ingestion.
- `tasks[].messageCount`: raw source message or Cursor bubble count.
- `tasks[].turnCount`: logical turn count after merging consecutive same-role messages.
- `tasks[].turns`: turn-level transcript used for productivity metrics.
- `privacy`: policy applied to text, paths, and raw message retention.

Cursor internals must stay behind the adapter boundary. Ingestion and BI should depend only on normalized events and observations.
