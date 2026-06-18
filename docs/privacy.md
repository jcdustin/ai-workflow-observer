# Privacy

Privacy is applied after local collection and local heuristic evaluation. This lets the collector compute task summaries, turns, and correction metrics locally, then upload a reduced payload.

## Text Modes

```text
raw       Keep original prompt and assistant text.
redacted  Replace text with length markers, for example [redacted:128].
hash      Replace text with deterministic SHA-256 markers and length.
```

## Path Modes

```text
raw       Keep full paths.
basename  Keep only the final filename or directory name.
hash      Replace paths with deterministic SHA-256 markers.
```

## Raw Conversation Storage

Use `--no-raw-messages` to remove `cursor.conversations` after local evaluation. Task-level turns and evidence are still included, subject to `--text-mode`.

## Recommended Enterprise Defaults

For an initial employee pilot:

```sh
AWO_TEXT_MODE=redacted
AWO_PATH_MODE=basename
AWO_INCLUDE_RAW_MESSAGES=false
```

For debugging adapter coverage on a small opt-in group:

```sh
AWO_TEXT_MODE=raw
AWO_PATH_MODE=raw
AWO_INCLUDE_RAW_MESSAGES=true
```

For BI-only production metrics:

```sh
AWO_TEXT_MODE=hash
AWO_PATH_MODE=hash
AWO_INCLUDE_RAW_MESSAGES=false
```

## CLI

```sh
pnpm collector -- \
  --repo /path/to/repo \
  --python-sqlite-command python3 \
  --text-mode redacted \
  --path-mode basename \
  --no-raw-messages \
  --output tmp-collector-run.json
```

The output includes a `privacy` object describing the applied policy.
