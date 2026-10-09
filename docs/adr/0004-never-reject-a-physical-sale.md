# ADR 0004: Never Reject a Physical Sale (Negative Stock Plus Exception)

## Context
In a physical store, the customer has the physical item in their hands at the checkout till. If system stock reaches zero due to concurrent sales or discrepancy, rejecting the sale halts retail operations.

## Decision
The register never blocks or aborts a physical sale due to zero or negative inventory. Stock counts are allowed to decrement into negative numbers, and an inventory discrepancy exception event is flagged for audit and reconciliation.

## Consequences
Cashier checkout flow is never interrupted; discrepancies are resolved asynchronously via ledger exception reports.
