# Testing

## Backend (Jest)

- Unit tests mock repositories/services. No real DB.
- Integration tests against a real Postgres (testcontainers or a dedicated `mes_test` DB).
- File location: mirror source under `__tests__/`. `service/PurchaseService.ts` → `service/__tests__/PurchaseService.spec.ts`.
- Factory functions for seed data — no shared mutable state.
- F.I.R.S.T.: Fast, Independent, Repeatable, Self-Validating, Timely.
- Test idempotency explicitly on POST endpoints with `Idempotency-Key`.
- Test the canonical error shape end-to-end.

## Frontend (Vitest + Testing Library)

- Co-locate `.test.tsx` with the component.
- Mock the network via MSW (or stub the apiClient).
- Query by role/label, not test-id.
- Use `@testing-library/user-event` for interactions.
- Test form validation error mapping from the backend's `details.fields`.

## Coverage targets

Pragmatic, not numeric — every business rule has at least one test that breaks if the rule changes. No naked happy paths.
