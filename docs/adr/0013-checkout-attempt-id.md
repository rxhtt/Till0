# ADR 0013: Checkout attempt_id

## Context
Aggressive double-tapping or accidental repeated clicks on the "PAY" button must never submit multiple sale completions for a single customer transaction.

## Decision
When the checkout sheet opens or initiates payment, a unique `attempt_id` is generated for that specific tender interaction. The local command queue guards against multiple submissions sharing the same cart state or attempt token.

## Consequences
Guaranteed single-charge and single-receipt issuance even under high-frequency button mashing.
