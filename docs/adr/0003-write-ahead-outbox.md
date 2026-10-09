# ADR 0003: Write-Ahead Outbox

## Context
Sales must never be lost if a browser tab crashes, refreshes, or loses power mid-checkout before reaching the server.

## Decision
All terminal actions append transactions to a persistent local write-ahead outbox in IndexedDB inside the same local transaction that updates local cart/ledger state. A background sync worker reads the outbox and flushes queued items to the server.

## Consequences
Guarantees durability of all offline and online sales before network transmission.
