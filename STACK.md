# STACK.md — Locked Stack & Pinned Versions

All libraries are resolved and locked to exact versions using `npm view` and `pip index versions`. Per AGENTS.md rule 3, no unlisted libraries may be introduced.

## Web (pnpm workspace)

| Package | Version | Purpose |
|---|---|---|
| `react` | `19.3.0` | UI framework |
| `react-dom` | `19.3.0` | DOM renderer for React |
| `@types/react` | `19.3.0` | Type definitions for React |
| `@types/react-dom` | `19.3.0` | Type definitions for React DOM |
| `vite` | `8.3.4` | Build tool and dev server |
| `@vitejs/plugin-react` | `6.1.2` | Vite React plugin |
| `typescript` | `5.8.3` | Language and typechecker |
| `tailwindcss` | `4.3.3` | Styling engine (v4) |
| `@tailwindcss/vite` | `4.3.3` | Tailwind v4 Vite plugin |
| `dexie` | `4.4.6` | IndexedDB wrapper (offline storage) |
| `motion` | `14.0.0` | Motion and animation library |
| `cmdk` | `1.1.1` | Command palette |
| `lucide-react` | `1.54.0` | Icon system |
| `vite-plugin-pwa` | `2.0.0` | PWA offline manifest & service worker |
| `ulid` | `3.0.2` | Monotonic unique ID generation |
| `vitest` | `5.0.3` | Unit test runner |
| `fake-indexeddb` | `6.2.5` | IndexedDB polyfill for Dexie unit tests in Node |
| `fast-check` | `4.10.2` | Property-based testing |
| `playwright` | `1.64.0` | E2E browser testing |
| `eslint` | `10.12.0` | Linter |
| `typescript-eslint` | `8.71.1` | TypeScript lint rules |
| `dependency-cruiser` | `18.5.0` | Architecture boundary enforcement |
| `openapi-typescript` | `7.13.0` | TypeScript type generation from OpenAPI schema |
| `@fontsource-variable/geist` | `5.3.0` | Self-hosted UI font (Geist Variable) |
| `@fontsource-variable/geist-mono` | `5.3.0` | Self-hosted mono font (Geist Mono Variable) |

## Server (Python 3.12 FastAPI)

| Package | Version | Purpose |
|---|---|---|
| `fastapi` | `0.143.0` | HTTP API framework |
| `uvicorn` | `0.54.0` | ASGI server |
| `psycopg[binary,pool]` | `3.3.6` | PostgreSQL driver and connection pooling |
| `pydantic` | `2.14.0` | Data validation and schemas |
| `pytest` | `9.1.1` | Python test runner |
| `pytest-asyncio` | `1.4.0` | Async testing support for pytest |
| `httpx` | `0.28.1` | Async HTTP client for integration tests |
| `ruff` | `0.16.10` | Fast Python linter and formatter |
| `mypy` | `2.4.0` | Strict static type checker |
