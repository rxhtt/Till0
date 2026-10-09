# ADR 0010: Sorted-SKU Update Order

## Context
Concurrent transactions updating multiple SKU inventory rows in varying sequence can trigger PostgreSQL deadlocks (e.g., Transaction A locks SKU-1 then SKU-2, while Transaction B locks SKU-2 then SKU-1).

## Decision
All database write operations that update inventory rows across multiple SKUs must sort the target SKU keys alphabetically/lexicographically before acquiring row-level locks (`SELECT ... FOR UPDATE` or `UPDATE ...`).

## Consequences
Deterministic locking order guarantees deadlock-free concurrent stock modifications.
