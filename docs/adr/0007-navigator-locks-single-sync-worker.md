# ADR 0007: navigator.locks Single Sync Worker

## Context
Multiple browser tabs or windows may be open simultaneously on the same device or terminal instance, risking concurrent conflicting outbox flush attempts.

## Decision
The background synchronization process acquires an exclusive Web Lock via `navigator.locks.request('till0_sync_worker_<terminal>', ...)` before flushing outbox records. Secondary tabs stand by or yield sync responsibility to the lock holder.

## Consequences
Eliminates outbox race conditions, duplicate batch payloads, and interleaved network transactions across tabs.
