# DECISIONS.md

Format: question, choice, reason (one line per undecided item).

- Font packages selection | @fontsource-variable/geist and @fontsource-variable/geist-mono | DESIGN.md requires Geist Variable self-hosted offline; fontsource packages are available and pinned.
- OpenAPI TypeScript generation mechanism | Export schema via python CLI and run openapi-typescript | Allows deterministic, offline generation without requiring live dev server.
- Monorepo package manager | pnpm with workspace protocol (workspace:*) | Mandated by specification (Task P0: pnpm workspace).
- TypeScript version selection | 5.8.3 | typescript-eslint 8.71.1 peerDependency requires typescript <6.1.0; 5.8.3 is latest stable TS 5.x.
- Postgres host port mapping | 5433:5432 | Host has active PostgreSQL service on port 5432; mapping container port 5432 to host port 5433 avoids collision while keeping container-to-container networking on port 5432.
- Low stock alert threshold default | 5 units | Standard retail threshold; configurable via LOW_STOCK_THRESHOLD environment variable.
- EAN-13 GS1 company prefix | 8901234 | 890 is India GS1 country code prefix; 1234 is arbitrary demo company prefix; check digit computed with standard EAN-13 modulo-10 algorithm.
