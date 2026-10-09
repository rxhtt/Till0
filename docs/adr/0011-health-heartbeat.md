# ADR 0011: /health Heartbeat Not navigator.onLine

## Context
The browser API `navigator.onLine` only indicates whether a local network interface is connected, not whether the backend API server is reachable or healthy.

## Decision
Online/offline connectivity is determined strictly by periodic lightweight `GET /health` heartbeats and real API response status. `navigator.onLine` events trigger an immediate probe rather than setting state directly.

## Consequences
Accurate detection of captive portals, dead gateways, server outages, and true end-to-end sync availability.
