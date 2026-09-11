# CloudFleet performance baseline

Generated at: 2026-09-10T19:21:50.513Z

Environment: http://backend:3000 (Docker local, warm service, 30s steady load per profile)

## Concurrent-user profiles

| Concurrent users | Throughput (flows/s) | Overall HTTP p95 (ms) | Flow error rate |
| ---------------: | -------------------: | --------------------: | --------------: |
|               50 |                 92.9 |                  56.7 |           0.00% |
|              200 |                133.4 |                2101.4 |           0.00% |
|              500 |                 81.7 |               11201.4 |           0.00% |

## Flow latency by load

| Flow p95 (ms)            | 50 users | 200 users | 500 users |
| ------------------------ | -------: | --------: | --------: |
| `get_orders`             |     31.0 |     772.2 |    3439.9 |
| `tracking_refresh`       |     50.7 |    1934.1 |   14243.9 |
| `gps_update`             |     76.2 |    2473.0 |   19189.1 |
| `assign_status_mutation` |    529.9 |    9832.1 |   30517.3 |
| `operations_issues`      |     30.0 |     778.8 |    3481.5 |

## Five slowest flows at 500 concurrent users

| Rank | Flow                     | p95 (ms) |
| ---: | ------------------------ | -------: |
|    1 | `assign_status_mutation` |  30517.3 |
|    2 | `gps_update`             |  19189.1 |
|    3 | `tracking_refresh`       |  14243.9 |
|    4 | `operations_issues`      |   3481.5 |
|    5 | `get_orders`             |   3439.9 |

## Findings

- The 50-user profile is inside the current performance budget; the 200- and 500-user profiles exceed it.
- Throughput peaks before 500 users while latency rises sharply, which is saturation/queueing rather than functional failure: the measured flow error rate stayed at 0%.
- Assignment/status is the slowest high-load flow. It combines idempotency records, capacity checks, consistent reads, transactions, event writes, and push lookup.
- GPS updates combine a consistent driver read, a two-item transaction, idempotency persistence, and optional realtime publication.
- Tracking refresh fans out after token/order resolution to timeline, driver, proof, and feedback reads.
- Both `GET /orders` and operations issues query every order-status partition when no status is supplied; operations then computes the exception queue in-process. This fan-out is the first query pattern to redesign.

## Interpretation

The ranking is based on end-to-end client timings. Correlate it with the CloudWatch dashboard using endpoint, DynamoDB, routing, geocoding, POD, push/SMS, and offline metrics before changing capacity or code. Results from DynamoDB Local/MinIO are a development baseline, not a substitute for a staging run using AWS and production providers.
