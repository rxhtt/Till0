# Till0

Industrial-grade, offline-first Point of Sale (POS) system engineered for high resilience, deterministic ledger synchronization, and thermal paper aesthetic.

## Architecture

- `apps/web`: Vite + React + TypeScript offline-first cashier terminal.
- `packages/core`: Pure TypeScript domain logic, offline outbox, money math (integer paise), event sourcing. No DOM/React imports.
- `packages/hardware`: Device adapters (USB/Serial thermal printers, barcode scanners).
- `server`: Python 3.12 FastAPI server with PostgreSQL 16 ledger.
- `docs/adr`: Architectural Decision Records.

## Development

```bash
# Install dependencies
pnpm install

# Run typechecks and linter
pnpm typecheck
pnpm lint

# Build workspace
pnpm build

# Start services via Docker Compose
docker compose up -d
```
