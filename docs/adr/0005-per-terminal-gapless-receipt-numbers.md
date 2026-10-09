# ADR 0005: Per-Terminal Gapless Receipt Numbers

## Context
Tax compliance and commercial audits require sequential, non-repeating receipt numbers without gaps for each till, even when operating completely offline.

## Decision
Each terminal maintains an atomic, monotonically increasing receipt sequence stored in local durable storage. Receipt numbers are prefixed with the terminal identifier (e.g. `T1-000104`) and incremented locally without consulting the central server.

## Consequences
Receipt numbering functions without network access and provides tamper-evident gapless accounting per till.
