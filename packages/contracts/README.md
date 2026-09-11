# CloudFleet contracts

`@cloudfleet/contracts` is the framework-neutral source of API DTOs and finite domain values shared by the API, React application and local E2E scenarios.

- `index.js` owns runtime values such as order, exception, driver, route and proof-content statuses.
- `index.d.ts` owns their derived types, API envelopes and response DTOs.
- `test/unit/contracts-and-schemas.test.ts` prevents DynamoDB documentation schemas from drifting from these values.

The package intentionally has no AWS, Express or React dependency. Add a public response field here first, then update its producer and consumers in the same change.
