# ADR 0008: Per-Terminal IndexedDB Name

## Context
When running multi-terminal simulations (such as the `/stage` view running T1 and T2 in adjacent iframes), sharing a single database would cross-contaminate local carts, outbox queues, and sequence numbers.

## Decision
IndexedDB database instances are strictly scoped per terminal ID, formatted as `till0_db_<terminalId>` (e.g. `till0_db_T1`, `till0_db_T2`).

## Consequences
Complete storage isolation between terminals running under the same origin or iframe sandbox.
