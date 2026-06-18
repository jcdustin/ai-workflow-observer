# Contributing

AI Workflow Observer is intended to be privacy-first infrastructure for measuring real AI workflow friction.

## Principles

- Prefer local evaluation before upload.
- Do not add new raw text or path fields without privacy handling.
- Treat vendor storage formats as unstable adapter inputs.
- Keep BI-facing schema stable and documented.
- Compare matched cohorts, not raw aggregate averages.

## Development

```sh
pnpm install
pnpm build
pnpm collector -- --repo . --python-sqlite-command python3 --text-mode redacted --path-mode basename --no-raw-messages --output tmp-collector-run.json
```

## Pull Requests

Please include:

- what changed
- how privacy behavior is affected
- how the change was tested
- any schema migration required
