# CloudFleet

CloudFleet is a real-time logistics management application with separate Admin
and Driver workspaces. The backend uses Node.js, Express, TypeScript and AWS SDK
v3; the frontend uses React, Vite, Tailwind CSS, Recharts and Leaflet with
OpenStreetMap tiles.

## Run locally with Docker Compose

Requirements: Docker Desktop and Node.js 20 or newer.

```bash
# One-time dependency setup after cloning.
npm install
npm --prefix frontend install
cp -n frontend/.env.example frontend/.env.local

# One command starts/updates DynamoDB Local, MinIO, the API and Vite frontend.
npm run local:dev
```

Open `http://localhost:5173`. The local endpoints are:

| Service        | URL                     |
| -------------- | ----------------------- |
| CloudFleet API | `http://localhost:3000` |
| DynamoDB Local | `http://localhost:8000` |
| MinIO S3 API   | `http://localhost:9000` |
| MinIO Console  | `http://localhost:9001` |

Useful lifecycle commands:

```bash
npm run local:status
npm run local:logs
npm run local:e2e
npm run local:down

# Destructive: also removes local DynamoDB and S3 volumes.
npm run local:reset
```

The local stack uses isolated MinIO credentials inside Docker and never reads or
stores real AWS credentials. `AUTH_MODE=disabled` gives the local demo user both
Admin and Driver roles. Re-running `local:up` preserves changed DynamoDB records;
`local:reset` recreates the original seed dataset. `local:e2e` creates a real
order, exercises customer rescheduling, assigns and starts it, uploads a small
proof image with signature/barcode/GPS metadata, completes delivery, records
customer feedback and verifies driver availability.

`local:status` includes the one-shot initializer. A healthy stack shows the API,
DynamoDB and MinIO as `healthy`, with `local-init` at `Exited (0)`.
The API exposes `/health` for process liveness and `/ready` for DynamoDB/S3
dependency readiness. Stop the foreground Vite process with Ctrl+C, then use
`npm run local:down` when you also want to stop the Docker services.

## Quality gate

Run the same safety net used by CI from the repository root:

```bash
npm run verify
```

It enforces Prettier and zero-warning ESLint, type-checks the backend, frontend
and infrastructure, runs backend/frontend coverage tests, builds the frontend,
synthesizes CDK and runs the integration suite against the local Compose stack.
See `docs/architecture.md` for module boundaries and coverage scope.

### End-to-end delivery demo

1. Open `/admin/orders` and create a pending order.
2. Open `/admin/dispatch`, assign an available driver and start delivery.
3. Open `/driver`; the assigned in-progress order is discovered automatically.
4. Capture or select a proof image and confirm delivery.
5. Verify the order under `/driver/history` and the available driver under
   `/admin/fleet`.

For real local API testing, keep `VITE_ENABLE_MOCK_FALLBACK=false` in the
frontend environment. The Driver workspace polls for assignment changes every
10 seconds and also provides a manual refresh action.

## Run without Docker Compose

This mode connects to real AWS resources. Use it only when the table and buckets
already exist and your AWS profile/Identity Center session is configured.
The backend reads `.env` (not `.env.local`) through `dotenv/config`.

```bash
# Terminal 1 — API
cp .env.example .env
# Replace the example resource names with deployed AWS outputs.
npm install
npm run dev

# Terminal 2 — React app
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`. The API health check is available at
`http://localhost:3000/health`.

Set `VITE_ENABLE_MOCK_FALLBACK=true` if you intentionally want the operational
screens to use their in-memory demo dataset when the API is unavailable.

## Application routes

| Route                    | Purpose                                          |
| ------------------------ | ------------------------------------------------ |
| `/`                      | Workspace selector                               |
| `/admin`                 | Operational analytics                            |
| `/admin/dispatch`        | Assign orders and start deliveries               |
| `/admin/fleet`           | Driver and vehicle management                    |
| `/admin/orders`          | Search and create orders                         |
| `/admin/settings`        | Workspace integrations                           |
| `/admin/orders/:orderId` | Order lifecycle, proof and operational actions   |
| `/admin/fleet/:driverId` | Live driver, assignment and delivery history     |
| `/driver`                | Current delivery and proof of delivery           |
| `/driver/history`        | Completed deliveries                             |
| `/driver/profile`        | Driver profile                                   |
| `/login`                 | Cognito Hosted UI sign-in                        |
| `/auth/callback`         | OAuth authorization-code callback                |
| `/track/:trackingToken`  | Public, private-token customer delivery tracking |

## REST API

| Method   | Endpoint                                  | Purpose                                                  |
| -------- | ----------------------------------------- | -------------------------------------------------------- |
| `GET`    | `/api/orders`                             | List orders by optional status or driver                 |
| `POST`   | `/api/orders`                             | Create an order                                          |
| `GET`    | `/api/orders/:id`                         | Get an order                                             |
| `GET`    | `/api/orders/:id/events`                  | Read the chronological order lifecycle                   |
| `GET`    | `/api/orders/:id/tracking-link`           | Admin-only private customer link                         |
| `GET`    | `/api/tracking/:trackingToken`            | Public redacted delivery tracking payload                |
| `POST`   | `/api/tracking/:trackingToken/reschedule` | Request a new delivery window using the capability token |
| `POST`   | `/api/tracking/:trackingToken/feedback`   | Submit a one-time post-delivery rating                   |
| `PATCH`  | `/api/orders/:id/assign`                  | Atomically assign an available driver                    |
| `PATCH`  | `/api/orders/:id/status`                  | Advance the order state                                  |
| `GET`    | `/api/drivers`                            | List drivers by optional status                          |
| `POST`   | `/api/drivers`                            | Create a driver                                          |
| `GET`    | `/api/drivers/:id`                        | Get a driver profile                                     |
| `PATCH`  | `/api/drivers/:id/status`                 | Change driver availability                               |
| `PATCH`  | `/api/drivers/:id/location`               | Persist and broadcast driver coordinates                 |
| `GET`    | `/api/push/public-key`                    | Read the configured VAPID public key                     |
| `POST`   | `/api/drivers/:id/push-subscriptions`     | Register a driver's browser push subscription            |
| `DELETE` | `/api/drivers/:id/push-subscriptions`     | Remove a driver's browser push subscription              |
| `POST`   | `/api/realtime/ticket`                    | Issue a one-time WebSocket connection ticket             |
| `GET`    | `/api/analytics/overview`                 | Read the latest EMR analytics snapshot                   |
| `POST`   | `/api/analytics/runs`                     | Start the automated DynamoDB export and EMR workflow     |
| `GET`    | `/api/analytics/runs/:runId`              | Read a Step Functions analytics execution status         |
| `GET`    | `/api/orders/:id/proof/upload-url`        | Create an S3 proof upload URL                            |
| `POST`   | `/api/orders/:id/proof`                   | Verify S3 object and store proof metadata                |
| `GET`    | `/api/orders/:id/proof`                   | Get proof metadata                                       |
| `GET`    | `/api/orders/:id/proof/view-url`          | Create a short-lived private proof read URL              |

All authenticated `POST`, `PUT`, `PATCH`, and `DELETE` requests require an
`Idempotency-Key` header containing 8–128 safe characters. A completed replay
returns the original status/body with `Idempotency-Replayed: true`; reusing the
same key for different input returns `409`. Every response includes
`X-Request-ID`, which is also emitted in structured request/error logs.

## Order lifecycle and exceptions

The normal delivery path is:

```text
PENDING → ASSIGNED → IN_PROGRESS → ARRIVED → DELIVERED
```

Operational exceptions support cancellation, failed delivery, rescheduling and
return-to-origin workflows. `DELIVERY_FAILED` and `CANCELLED` require a reason:

```text
IN_PROGRESS/ARRIVED → DELIVERY_FAILED → RESCHEDULED → ASSIGNED
                                      ↘ RETURNING → RETURNED
PENDING/ASSIGNED/IN_PROGRESS → CANCELLED
```

## DynamoDB access patterns

CloudFleet uses a single-table design:

- Orders: `PK=ORDER#<id>`, `SK=METADATA`
- Drivers: `PK=DRIVER#<id>`, `SK=PROFILE`
- Delivery proofs: `PK=ORDER#<id>`, `SK=PROOF#POD`
- Customer feedback: `PK=ORDER#<id>`, `SK=CUSTOMER#FEEDBACK`
- Driver push endpoints: `PK=DRIVER#<id>`, `SK=PUSH#<sha256(endpoint)>`
- Order events: `PK=ORDER#<id>`, `SK=EVENT#<time>#<eventId>`
- Driver location history: `PK=DRIVER#<id>`, `SK=LOCATION#<time>#<uuid>`
- WebSocket connections: `PK=WS_CONNECTIONS`, `SK=<connectionId>`
- Tracking token by order: `PK=ORDER#<id>`, `SK=TRACKING#TOKEN`
- Hashed public lookup: `PK=TRACKING#<sha256(token)>`, `SK=TOKEN`
- `GSI1` lists a driver's orders by status and creation time.
- `GSI2` lists orders or drivers by operational status without table scans.
- Order assignment updates the order and driver in one DynamoDB transaction.
- Route start acquires the driver's `activeOrderId` lock; completion releases it,
  preventing two queued orders from becoming active at the same time.
- Completing a delivery atomically marks the driver available and increments
  their daily delivery count, and requires a registered proof item.
- Each lifecycle mutation stores its order event in the same DynamoDB
  transaction, so the Admin timeline cannot drift from the current order.
- Tracking links use 256-bit random capability tokens with a 30-day TTL. The
  public API checks expiration immediately and returns a redacted DTO without
  `orderId`, customer phone, driver ID, event actors or S3 object keys.

## Authentication and roles

Set `AUTH_MODE=cognito` on the backend and `VITE_AUTH_MODE=cognito` on the
frontend after deployment. Cognito access tokens are verified at API Gateway
and again inside Express. The `ADMIN` group can manage orders, dispatch and
drivers; `DRIVER` can read assigned work, upload proof and advance delivery
status. For driver users, set the Cognito username to the matching CloudFleet
`driverId` (for example `DRV-018`); ownership checks prevent cross-driver order
access. Local development defaults to `disabled` and receives both roles.

The target table must include both `GSI1` and `GSI2`. The complete definition is
documented in `src/infrastructure/database/schemas/orders-table.schema.json`.
Existing tables created from the earlier schema must add `GSI2` before the new
list APIs are enabled.

## Sprint 2 operations

Orders now carry optional delivery constraints: `timeWindowStart`,
`timeWindowEnd`, `packageWeightKg`, `packageVolumeM3` and
`serviceDurationMinutes`. Drivers carry `maxWeightKg` and `maxVolumeM3`;
legacy records use 20 kg and 0.25 m³ defaults.

- Import up to 100 orders with `POST /api/orders/import` and
  `Content-Type: text/csv`. The response is `201` when every row succeeds or
  `207` with a row-level error report for a partial import.
- Export orders with `GET /api/orders/export.csv`.
- Validate an address manually with `POST /api/geocoding/validate`. Local mode
  uses Nominatim with a one-request-per-second limiter and a 24-hour in-memory
  cache. Do not use the public endpoint for bulk imports; configure a managed
  or self-hosted provider for production volume.
- Create an atomic multi-stop assignment with `POST /api/routes` using
  `{ "driverId", "orderIds", "scheduledDate" }`. Routes are limited to 25 new
  stops so one DynamoDB transaction can either assign every stop or none.
  Existing active load is included in the capacity check.
- Read a route with `GET /api/routes/:id`, or list a driver's summaries with
  `GET /api/routes?driverId=...`.

The Admin Orders screen exposes import, export, address lookup, delivery
constraints and multi-select route planning. A ready-to-edit input file is at
`examples/orders-import.csv`.

## Sprint 3 route intelligence

Every new route now stores an immutable planning snapshot: origin, ordered
stops, leg distance/duration, arrival and departure ETA, route geometry,
provider name and revision. The optimizer minimizes travel duration while
penalizing missed time windows and includes each stop's service duration.

- Set `ROUTING_PROVIDER=osrm` to use OSRM's road-duration matrix and GeoJSON
  route geometry. If the provider is unavailable, CloudFleet returns a clearly
  labelled `straight-line-fallback` plan instead of blocking dispatch.
- `PATCH /api/routes/:id/reorder` saves a complete manual stop order.
- `POST /api/routes/:id/re-optimize` calculates and atomically stores a new
  automatic revision. Reordering is restricted to `PLANNED` routes so an
  active driver's sequence cannot silently change.
- `GET /api/routes/:id` includes planned-vs-actual duration, variance,
  completed/on-time/late counts, per-stop SLA status and ETA.
- `GET /api/operations/issues` returns the priority-sorted action queue for
  failed delivery, rescheduling, breached SLA, predicted lateness and urgent
  unassigned orders.

The Admin application includes Route Plans, Route Detail and Attention Queue
screens. Route Detail renders the planned geometry and supports move-up/down,
manual save and re-optimization.

## Sprint 4 field experience

The Driver workspace is now an installable PWA. Its service worker caches the
application shell and versioned assets. Assigned-order snapshots, route status
mutations and GPS updates are stored in IndexedDB; queued mutations retain their
original idempotency key and flush in order when connectivity returns. Draft POD
photos, recipient details, notes, barcode and signature also survive a reload,
but the S3 upload waits for a connection.

POD registration verifies the uploaded object as before, then stores the
recipient name, signature, parcel barcode, notes and device GPS/accuracy. The
browser attempts barcode detection when supported and always keeps a manual
entry fallback because native Barcode Detection is not universal.

Driver push uses Web Push with VAPID. Generate a key pair without committing the
private key:

```bash
npm run generate:vapid
```

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` in the local
environment, or replace the matching fields in the deployed Secrets Manager
secret. Drivers opt in per device from `/driver/profile`; new direct assignments
and route plans trigger a notification. Missing VAPID configuration disables
push cleanly without affecting delivery operations.

The private customer tracking page can request a future delivery window before
dispatch/start and submit one rating after delivery. Reschedule requests surface
as critical items in the Admin Attention Queue. Customer SMS notifications now
cover in-transit, driver-arrived, delivered, failed and rescheduled transitions,
and include the same private tracking/manage link.

## Realtime location

The Driver app uses the browser Geolocation API while an order is in progress
and sends at most one update every 10 seconds. The backend atomically updates
the driver profile and appends a 30-day location-history item. Admin clients
obtain a one-time REST ticket, connect to API Gateway WebSocket, and receive
`driver.location.updated` events without exposing a Cognito token in the URL.

## Customer tracking

When delivery starts, the DynamoDB Stream Lambda includes the private tracking
link in the Twilio SMS. The public page refreshes the token-scoped endpoint,
showing status, a sanitized timeline, fresh driver distance/ETA, destination
map and Proof of Delivery confirmation. Existing orders receive a token lazily
on their next status transition or when an Admin copies the tracking link.

API Gateway leaves only the token-scoped tracking GET/feedback/reschedule routes
unauthenticated; all order-ID routes remain behind Cognito and role checks.

## Driver delivery workflow

The mobile Driver workspace separates each operational step: review assignment,
start the route, confirm arrival, capture/review proof, upload it directly to
S3 with progress, and finally confirm delivery. Network and location permission
states are explicit; a failed upload or confirmation can be retried without
discarding the selected image. ETA uses the live straight-line distance and a
city-driving estimate, while OpenStreetMap provides the external navigation
link. The completion receipt links to Driver History and previews queued work.

Driver History is calculated from DynamoDB data rather than display constants.
Its date range filters real assignments; success rate is delivered assignments
divided by all assignments in the window, and active time uses the recorded
`DELIVERY_STARTED` and `DELIVERY_COMPLETED` events with a legacy timestamp
fallback.

## Automated EMR analytics

An admin starts a refresh from the Analytics dashboard. The ECS API starts an
AWS Step Functions execution, which exports the DynamoDB table to S3, waits for
the export, submits `analytics/emr/jobs/delivery_performance.py` to EMR
Serverless, and waits for the Spark job to finish. The job calculates global and
regional delivery metrics and atomically replaces
`analytics/latest/overview.json`; the dashboard polls the durable execution and
reloads the snapshot when it succeeds. No AWS Console or CLI action is required
in the application flow. Operational details are in `analytics/emr/README.md`.

## Verification

```bash
npm run typecheck
npm run build
npm test

cd frontend
npm run typecheck
npm run build
```

With the local stack running, execute all unit, integration and end-to-end
checks in one command:

```bash
npm run test:local
```

## AWS infrastructure

The deployable AWS CDK application is in `infra/`. It provisions DynamoDB with
Streams and two GSIs, private S3 buckets, CloudFront hosting with Origin Access
Control and React Router fallback, the delivery notification Lambda, Cognito,
ECS Fargate, an internal ALB, and an API Gateway HTTP API with a VPC Link and
Cognito JWT authorizer. CDK builds and uploads the frontend and creates its
production API/Cognito runtime configuration automatically.

The backend container is built from the root `Dockerfile`. See
`infra/README.md` for deployment prerequisites and commands.
