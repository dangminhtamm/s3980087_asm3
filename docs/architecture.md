# CloudFleet architecture and module boundaries

This document records the dependency rules that protect CloudFleet while the codebase is refactored. It describes the current deployable units and the target boundaries; it does not change the REST API or business behaviour.

## Deployable units

- `src/`: Express API plus the Lambda entry points used for notifications, realtime connections and analytics orchestration.
- `frontend/`: React/Vite admin, driver PWA and public tracking application.
- `infra/`: AWS CDK deployment definition.
- `analytics/emr/`: Spark job deployed to EMR Serverless.
- `test/` and `load/`: backend characterization/integration tests and k6 performance scenarios.

## Backend dependency direction

```text
HTTP routes/controllers -> application services -> domain
                               |                  ^
                               v                  |
                         infrastructure adapters -+
```

The allowed responsibilities are:

- `domain/`: entities, value types and pure business rules such as order lifecycle, capacity and route-sequence optimization. It must not import Express, AWS SDK, environment variables or infrastructure code.
- `use-cases/`: focused application commands. A use case coordinates injected ports and domain rules; it does not construct an AWS client or know an HTTP request.
- `services/`: small application facades and focused orchestration services. `OrderService` and `RouteService` preserve the stable caller API while delegating writes to use cases and repositories.
- `repositories/`: DynamoDB query, transaction and optimistic-concurrency ownership. Stored records are parsed by Zod mappers before entering application/domain code.
- `ports/`: provider-neutral contracts for database execution, routing, geocoding, push delivery, time and ID generation.
- `infrastructure/dynamodb/`: the document-client adapter, all DynamoDB key construction (`DynamoKeys`) and stored-record mappers.
- `controllers/`: HTTP translation only: validate input, call one application workflow and serialize the result. Business rules, CSV loops and provider orchestration do not belong here.
- `routes/`: URL, authentication, authorization and middleware composition. Object construction belongs in one composition root.
- `config/`: validated runtime configuration and construction of external clients. Feature modules must not read `process.env` directly.
- `lambdas/`: thin AWS event adapters. Provider and persistence logic must be independently testable.
- `observability/`: cross-cutting metrics and logging. It may observe a workflow but must not determine its business outcome.

## API composition and startup

The API has a single composition path:

```text
main.ts -> startServer() -> createContainer(config) -> createApiRouter(dependencies)
                                                   -> createHealthRouter(dependencies)
        -> createApp({ config, apiRouter, healthRouter })
```

- `main.ts` is the only executable API entry point. Importing `server.ts` or `app.ts` never opens a port.
- `app.ts` is a pure Express factory and accepts already-constructed routers.
- `composition-root.ts` constructs each shared client, service, workflow and controller once.
- `config/app-config.ts` is the only API runtime module allowed to read `process.env`; it validates and groups all settings before object construction.
- Feature routers (`orders.routes`, `drivers.routes`, `routes.routes`, `tracking.routes`, and `analytics.routes`) own endpoint wiring while `api.routes.ts` only composes them and applies cross-cutting middleware.
- Health and readiness endpoints live under `health/` and receive readiness probes as dependencies.

## Mutation and notification boundary

Order assignment and route creation finish their DynamoDB transaction before returning. Push notification is dispatched as a best-effort background side effect through `PushPort`; provider latency or failure cannot extend or roll back the primary mutation response. Delivery outcomes remain observable through push metrics and structured error logs.

## Frontend dependency direction

```text
pages -> feature components/hooks -> feature API or offline ports -> shared HTTP/storage adapters
```

- Pages compose features and route state; they do not implement API clients or persistence.
- Feature hooks own async workflow state and expose explicit commands to components.
- UI components render props and emit user intents. They do not access Axios or IndexedDB directly.
- Production API adapters, offline adapters and mock/demo adapters remain separate and interchangeable.
- Public tracking DTOs must never expose private order or driver fields.

The frontend is organized around `features/orders`, `features/drivers`, `features/routes`,
`features/tracking`, `features/proof-of-delivery`, `features/analytics` and
`features/offline-sync`. Shared HTTP, auth, runtime configuration and UI exports live under
`shared/`. The legacy files under `services/` are compatibility barrels only; new code imports
the owning feature directly.

`features/offline-sync` separates its IndexedDB repository, retry/conflict policy and sync engine.
The mock fallback is a development-only adapter loaded lazily, so mutable demo state is excluded
from production bundles. Frontend behavior is characterized with Vitest, React Testing Library,
MSW and fake IndexedDB.

## Infrastructure boundary

The root CDK stack is the composition layer. Resource groups will become focused constructs for operational data, storage, identity, frontend hosting, API compute, realtime, analytics and observability. Application code must not import CDK modules.

## Contract ownership

- `packages/contracts` is the framework-neutral source for finite domain values, public DTOs and API envelopes. Backend domain aliases, frontend feature types and local E2E scenarios import it rather than declaring transport shapes independently.
- Zod request schemas remain authoritative for runtime HTTP input validation and consume the canonical finite values through backend domain re-exports.
- DynamoDB JSON schemas document persisted items. `contracts-and-schemas.test.ts` automatically checks every schema is parseable and verifies status, exception, event and proof enums against the shared contract.
- The shared package must not import AWS, Express or React. Provider-specific data is mapped at an adapter boundary before entering a shared DTO.

## Lambda and local-tool boundaries

- Lambda handlers construct adapters and translate AWS events only. Delivery notification, analytics workflow and realtime connection decisions live in services tested against in-memory ports.
- Twilio HTTP, Secrets Manager, DynamoDB stream/persistence and EMR Serverless calls live in named adapters under their owning Lambda.
- `local-bootstrap.ts` runs resource setup, ordered migrations and the explicit `2026-09-12-v1` fixture independently. Conditional writes and ensure-style resource creation make repeated runs safe.
- `local-e2e.ts` is a runner; HTTP concerns, generated fixtures and scenario assertions live under `src/scripts/local-e2e/`.

## Quality gates

Every change must pass `npm run verify`. The command checks formatting and linting, runs backend and frontend coverage tests, type-checks every TypeScript project, builds the frontend, synthesizes CDK, starts the local dependencies and executes integration tests. If the local Compose stack was not running before verification, the command stops it afterward without deleting volumes.

The initial 80% backend coverage gate applies to the core lifecycle, order, assignment, route, tracking, geocoding, idempotency and operations workflow modules listed in `.c8rc.json`. AWS/provider adapters remain visible in ordinary unit and integration tests and will join the threshold as their injectable boundaries are introduced.

Refactors must preserve:

- REST paths, status codes and response envelopes;
- order lifecycle and exception rules;
- DynamoDB atomicity and idempotency semantics;
- authorization boundaries and public tracking redaction;
- the existing 50-user performance budget.
