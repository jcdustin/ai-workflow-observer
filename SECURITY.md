# Security

This project can process sensitive prompts, assistant responses, file paths, repository metadata, and workflow traces.

## Reporting

For now, report security issues privately to the project maintainers. Do not open public issues containing secrets, prompts, private code, paths, or customer data.

## Deployment Guidance

- Run ingestion inside a private network.
- Use department keys or stronger machine identity for upload authorization.
- Prefer `AWO_TEXT_MODE=redacted` or `AWO_TEXT_MODE=hash` for pilots.
- Prefer `AWO_INCLUDE_RAW_MESSAGES=false` for production metrics.
- Keep in-house model API keys on server-side workers, not employee machines.
- Avoid using this data for individual performance ranking.
