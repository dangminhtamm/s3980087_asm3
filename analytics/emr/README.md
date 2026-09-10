# CloudFleet automated EMR analytics

The Admin Analytics page starts this pipeline through
`POST /api/analytics/runs`; no AWS Console or CLI step is part of the normal
application flow.

```text
Admin UI
  -> ECS API starts Step Functions
  -> Lambda starts DynamoDB point-in-time export to the analytics bucket
  -> Step Functions waits and polls the export
  -> Lambda starts the EMR Serverless Spark job
  -> Step Functions waits and polls the job
  -> Spark writes analytics/latest/overview.json
  -> Admin UI reloads GET /api/analytics/overview
```

## Components

- `jobs/delivery_performance.py` reads DynamoDB export JSON, filters order
  metadata records, and builds versioned daily, regional and hourly rollups.
- `src/lambdas/analytics-workflow/lambda-handler.ts` performs one short AWS API
  operation per invocation. It never waits inside Lambda.
- The Standard Step Functions workflow owns waits, branching, retries, execution
  history and the two-hour workflow timeout.
- The ECS task role can start and inspect the workflow but cannot call EMR or
  export DynamoDB directly.
- The EMR execution role can read the export and Spark entry point and write the
  stable dashboard snapshot.

## API

Start a refresh as an authenticated Admin:

```http
POST /api/analytics/runs
```

The API returns `202 Accepted` and a `runId`. The frontend polls:

```http
GET /api/analytics/runs/{runId}
```

The run response includes a progress timeline derived from Step Functions
execution history: DynamoDB export, EMR startup, Spark aggregation and S3
snapshot publication.

Dashboard queries accept an inclusive date range and optional region:

```http
GET /api/analytics/overview?from=2026-08-01&to=2026-08-31&region=District%201
```

The API calculates an equal-length previous period for comparison. Date ranges
are limited to 367 days so malformed requests cannot create unbounded output.

Only one running execution is accepted at a time. A concurrent request returns
`409 ANALYTICS_RUN_IN_PROGRESS`. Docker Compose intentionally has no Step
Functions emulator, so the start endpoint returns
`503 ANALYTICS_AUTOMATION_NOT_CONFIGURED` locally while the existing seeded
snapshot remains available for UI development.

## Output contract

The Spark job writes one JSON object to:

```text
s3://<analytics-bucket>/analytics/latest/overview.json
```

The schema-v2 object contains daily totals, regional totals and hourly volume;
it contains no customer-level records. The backend validates it with Zod, then
aggregates the requested date range in memory. DynamoDB exports are retained
under `dynamodb-exports/<run-id>/` for traceability and can be removed later
with an S3 lifecycle rule if required.

Use the Step Functions execution graph, EMR Serverless job run and CloudWatch
logs to troubleshoot failures. CLI commands are optional operational tools, not
part of the automated user flow.
