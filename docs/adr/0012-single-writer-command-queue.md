# ADR 0012: Single-Writer Command Queue

## Context
Rapid cashier input (barcode bursts, fast touch interactions) could generate race conditions if interleaved across multiple asynchronous state mutators.

## Decision
All terminal state mutations (scan item, adjust quantity, tender payment) are dispatched into an in-memory sequential promise-chained command queue per till. Operations execute strictly one at a time in submission order.

## Consequences
Deterministic cart and local outbox mutations with zero race conditions during burst operations.
