# ADR 0014: Transaction Advisory Lock for Commit-Ordered Gapless server_seq

## Context
Distributed POS terminals continuously push events to `/sync/push` while other terminals pull event logs via `/sync/pull?since=<cursor>`.

Using default database sequences (`BIGSERIAL` / `nextval`) presents two major failure modes:
1. **Sequence Gaps on Conflict or Rollback:** Sequence generators advance immediately upon call and are never rolled back. Duplicate events (`ON CONFLICT DO NOTHING`) and malformed events that roll back a transaction savepoint permanently discard generated sequence values, creating artificial gaps in `server_seq`.
2. **Out-of-Order Commits (Pull Cursor Race):** When concurrent transactions acquire sequence values (e.g. Transaction A gets seq 1, Transaction B gets seq 2), Transaction B may commit before Transaction A. A puller that requests events sees seq 2, advances its cursor to 2, and permanently skips seq 1 when Transaction A later commits.

## Decision
1. Serialize `/sync/push` executions within the database using a transaction-scoped advisory lock:
   ```sql
   SELECT pg_advisory_xact_lock(42424242);
   ```
2. Allocate `server_seq` from a transactional counter row (`server_sequence`) only after an event is verified as non-duplicate and newly applied.
3. Check for event existence first; duplicate events and rejected events never increment the sequence counter.
4. Keep sorted-SKU order for row locking on `stock_balance`.

## Consequences
- **Pros:**
  - Guaranteed gapless `server_seq` sequence.
  - Strict commit ordering: event sequence matches commit visibility order, preventing skips or missing events in `/sync/pull` pagination.
  - Audit conservation and sequence gap checks pass cleanly even under heavy concurrent duplicate and malformed workloads.
- **Trade-offs:**
  - `/sync/push` operations serialize at the database level. For the retail store deployment target (2 to 4 POS terminals pushing batches), throughput is on the order of milliseconds, making serial throughput more than sufficient while avoiding complex distributed consensus or reconciliations.
