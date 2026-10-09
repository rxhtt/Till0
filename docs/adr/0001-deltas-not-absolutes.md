# ADR 0001: Deltas Not Absolutes

## Context
When multiple terminals sell items offline or concurrently, updating inventory state using absolute stock values causes lost updates and race conditions.

## Decision
All stock adjustment events convey integer signed deltas (e.g., `-1`, `+5`) rather than absolute balances. The server applies commutative delta additions.

## Consequences
Stock reconciles reliably without last-write-wins collisions across terminals.
