# ADR 0006: server_seq Ordering Not Client Clocks

## Context
Client hardware device clocks drift, are misconfigured, or can be manipulated, making wall-clock timestamps unsuitable for establishing global event ordering.

## Decision
Global sequence ordering on the server is governed strictly by a server-assigned monotonic sequence integer (`server_seq`). While client event metadata includes the client's local timestamp for human reference, all reconciliations and event streams order by `server_seq`.

## Consequences
Deterministic event log ordering across all distributed terminals regardless of clock skew.
