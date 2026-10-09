# ADR 0009: Per-Event SAVEPOINT With Dead Letters

## Context
When a client syncs an outbox batch containing multiple events, a malformed or invalid event must not cause the entire batch to fail and indefinitely block valid queued sales.

## Decision
On the server, batch synchronization wraps each event in an individual database transaction `SAVEPOINT`. If an unrecoverable error occurs on an individual event, that savepoint is rolled back, the malformed event is quarantined to a `dead_letters` table, and processing continues for the remaining batch events.

## Consequences
Batch ingestion is resilient; poisoned events cannot wedge the sync pipeline.
