# Ingestion API

The ingestion API is a minimal private-deployment entry point for collector output.

## Run

```sh
pnpm build
export AWO_DEPARTMENT_KEYS='{
  "engineering": {"keyId": "engineering-v1", "key": "eng_dev_replace_me"},
  "product": {"keyId": "product-v1", "key": "prd_dev_replace_me"},
  "design": {"keyId": "design-v1", "key": "dsn_dev_replace_me"},
  "data": {"keyId": "data-v1", "key": "data_dev_replace_me"},
  "ops": {"keyId": "ops-v1", "key": "ops_dev_replace_me"},
  "support": {"keyId": "support-v1", "key": "sup_dev_replace_me"}
}'
PORT=3010 AWO_DATA_DIR=./data pnpm ingestion
```

## Endpoints

```text
GET /health
POST /v1/collector-runs
```

`POST /v1/collector-runs` accepts a `CollectorRun` JSON document and appends it to `collector-runs.jsonl`.

Example:

```sh
curl -X POST http://127.0.0.1:3010/v1/collector-runs \
  -H 'content-type: application/json' \
  -H 'x-awo-department-key: eng_dev_replace_me' \
  --data-binary @tmp-collector-run.json
```

This JSONL writer is intentionally simple. Replace it with a Postgres, ClickHouse, or warehouse writer once the event contract stabilizes.

## Department Keys

Department keys let one ingestion API separate usage by department without exposing individual employees in dashboards.

Accepted formats:

```sh
export AWO_DEPARTMENT_KEYS='engineering:eng_key,product:prd_key,design:dsn_key,data:data_key,ops:ops_key,support:sup_key'
```

or JSON:

```json
{
  "engineering": {"keyId": "engineering-v1", "key": "eng_key"},
  "product": {"keyId": "product-v1", "key": "prd_key"}
}
```

Clients send the key as either:

```text
x-awo-department-key: <key>
```

or:

```text
Authorization: Bearer <key>
```

The server stores `departmentId` and `keyId`, never the raw key.

Collector direct upload:

```sh
pnpm collector -- \
  --repo /path/to/repo \
  --python-sqlite-command python3 \
  --upload-url http://127.0.0.1:3010/v1/collector-runs \
  --department-key eng_dev_replace_me \
  --output tmp-collector-run.json
```
