# CloudFleet observability and performance

The API writes structured request logs and CloudWatch Embedded Metric Format (EMF) lines to stdout. Local Docker logs remain searchable JSON; ECS and Lambda log groups extract the same records into the `CloudFleet/Observability` namespace.

## Metric groups

- HTTP: request count, error rate, and latency by method and normalized route; status class remains a searchable log property.
- DynamoDB: request/error latency, returned/scanned items, and consumed capacity by operation (including read/write splits when the provider returns them).
- Providers: OSRM/geocoding latency, error/fallback count, route optimization and whole-plan duration.
- Delivery: browser-to-S3 POD upload, S3 verification, proof registration, Web Push and Twilio SMS outcomes.
- PWA: outbox size, completed items, retries, conflicts, and flush duration.
- Frontend: LCP, INP, and CLS with page/device/rating dimensions.

No order ID, tracking token, address, phone number, push endpoint, or proof object key is used as a metric dimension. This keeps cardinality and customer-data exposure bounded.

## Local baseline

Start the stack and run all three profiles:

```sh
npm run local:up
npm run perf:baseline
```

Override the target or duration when needed:

```sh
BASE_URL=https://api.example.com AUTH_TOKEN=... TEST_DURATION=2m npm run perf:200
```

The k6 test covers `GET /api/orders`, customer tracking refresh, driver GPS updates, assign/status mutations, and the operations issue queue. It writes raw summaries under `load/reports/`; the report generator writes `docs/performance-baseline.md` and ranks the five slowest flows at 500 VUs.

Run staging with an admin Cognito access token. Local DynamoDB and MinIO results are useful for regression detection, but staging is authoritative for AWS capacity and real OSRM/geocoding/provider latency.

## Performance budget

`performance-budget.json` is the single budget file used by k6 and the CI verifier. Pull requests run a 50-user, 20-second gate. The scheduled/manual workflow runs 50, 200, and 500-user profiles and uploads the raw summaries plus the generated report.

Frontend budgets use p75: LCP ≤ 2500 ms, INP ≤ 200 ms, and CLS ≤ 0.1. API budgets use a flow error rate below 1%, overall p95 below 1000 ms and p99 below 2000 ms, with tighter per-flow thresholds where appropriate.
