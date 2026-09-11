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

- `domain/`: entities, value types and pure business rules. It must not import Express, AWS SDK, environment variables or infrastructure code.
- `services/`: application workflows and ports. Services may coordinate domain rules and injected adapters. During the next clean sprint, direct DynamoDB code will move behind repositories.
- `controllers/`: HTTP translation only: validate input, call one application workflow and serialize the result. Business rules, CSV loops and provider orchestration do not belong here.
- `routes/`: URL, authentication, authorization and middleware composition. Object construction belongs in one composition root.
- `config/`: validated runtime configuration and construction of external clients. Feature modules must not read `process.env` directly.
- `lambdas/`: thin AWS event adapters. Provider and persistence logic must be independently testable.
- `observability/`: cross-cutting metrics and logging. It may observe a workflow but must not determine its business outcome.

## Frontend dependency direction

```text
pages -> feature components/hooks -> feature API or offline ports -> shared HTTP/storage adapters
```

- Pages compose features and route state; they do not implement API clients or persistence.
- Feature hooks own async workflow state and expose explicit commands to components.
- UI components render props and emit user intents. They do not access Axios or IndexedDB directly.
- Production API adapters, offline adapters and mock/demo adapters remain separate and interchangeable.
- Public tracking DTOs must never expose private order or driver fields.

## Infrastructure boundary

The root CDK stack is the composition layer. Resource groups will become focused constructs for operational data, storage, identity, frontend hosting, API compute, realtime, analytics and observability. Application code must not import CDK modules.

## Contract ownership

- Zod request schemas currently define the authoritative HTTP input contract.
- Domain entities define backend output types.
- Frontend and E2E declarations are temporary mirrors. A later sprint will replace these mirrors with generated or shared contracts.
- DynamoDB JSON schemas are documentation until an automated schema check is added; they must not be treated as runtime validation.

## Quality gates

Every change must pass `npm run verify`. The command checks formatting and linting, runs backend and frontend coverage tests, type-checks every TypeScript project, builds the frontend, synthesizes CDK, starts the local dependencies and executes integration tests. If the local Compose stack was not running before verification, the command stops it afterward without deleting volumes.

The initial 80% backend coverage gate applies to the core lifecycle, order, assignment, route, tracking, geocoding, idempotency and operations workflow modules listed in `.c8rc.json`. AWS/provider adapters remain visible in ordinary unit and integration tests and will join the threshold as their injectable boundaries are introduced.

Refactors must preserve:

- REST paths, status codes and response envelopes;
- order lifecycle and exception rules;
- DynamoDB atomicity and idempotency semantics;
- authorization boundaries and public tracking redaction;
- the existing 50-user performance budget.
