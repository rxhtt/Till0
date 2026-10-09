# PHASE_LOG.md

Log of phase executions and command results.

## Phase 0: Workspace Scaffolding and Quality Gates

Status: Completed
Date: 2026-10-09

### Acceptance Criteria Verification

1. **pnpm build, typecheck, and lint pass:**
   - `pnpm lint` (`eslint . && pnpm depcruise`): PASSED (0 errors, 36 modules cruised, 0 boundary violations).
   - `pnpm typecheck` (`tsc -p tsconfig.json --noEmit` across all workspaces): PASSED (0 errors).
   - `pnpm test` (vitest unit tests and fast-check property tests across packages): PASSED (6 passed across 3 test files).
   - `pnpm build`: PASSED (production bundles emitted for `@till0/core`, `@till0/hardware`, `@till0/web` with local font bundling and PWA service worker).

2. **docker compose up serves GET /health = 200:**
   - Command: `curl -i http://localhost:8000/health`
   - Result:
     ```
     HTTP/1.1 200 OK
     date: Fri, 09 Oct 2026 10:38:07 GMT
     server: uvicorn
     content-length: 33
     content-type: application/json

     {"status":"ok","version":"0.1.0"}
     ```

3. **Web app shows only a bg-0 page with the word Till0:**
   - Render verification: `apps/web/test/app.test.tsx` and built static output verify only `<main className="min-h-screen bg-bg-0 text-text flex items-center justify-center"><h1 className="text-[28px] font-semibold tracking-tight text-text">Till0</h1></main>`.

4. **Deliberate boundary violation is caught by dependency-cruiser, then removed:**
   - Injection: Added `import 'react';` to `packages/core/src/index.ts`.
   - Command: `pnpm depcruise`
   - Output:
     ```
     error core-no-react-or-dom: packages/core/src/index.ts → react
     x 1 dependency violations (1 errors, 0 warnings). 34 modules, 31 dependencies cruised.
     ```
     Command exited with code 1.
   - Removal: Removed `import 'react'` from `packages/core/src/index.ts`.
   - Re-run: `pnpm depcruise` exited with code 0 (`✔ no dependency violations found`).

5. **CI config is valid:**
   - Verified YAML syntax of `.github/workflows/ci.yml`.
   - All CI steps (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `ruff check`, `mypy --strict`, `pytest`) ran locally and exited with code 0.

## Drift Check — 2026-10-09

Compared every file, dependency, color, font size, and animation against SPEC.md and DESIGN.md.

### Removed (not in SPEC.md or DESIGN.md)

| Item | File | Reason |
|---|---|---|
| `apps/web/src/App.js` | source tree | Compiled JS artifact of App.tsx — no JS source files specified |
| `apps/web/src/main.js` | source tree | Compiled JS artifact of main.tsx |
| `apps/web/vite.config.js` | source tree | Compiled JS artifact of vite.config.ts |
| `apps/web/tsconfig.tsbuildinfo` | source tree | tsc incremental build info, not source |
| `tracking-tight` class | `apps/web/src/App.tsx` line 10 | Letter-spacing not in DESIGN.md tokens (AGENTS rule 2) |
| `antialiased` class | `apps/web/index.html` body | Not in DESIGN.md (AGENTS rule 2) |

Added `*.tsbuildinfo` to `.gitignore` to prevent artifact recurrence.

### No drift found in

- Colors: all 10 tokens in `index.css` match DESIGN.md exactly
- Font sizes: `text-[28px]` is in the allowed set {12,14,16,20,**28**,48}
- Font weights: `font-semibold` = 600, in allowed set {400,600}
- Radii: 4px and 12px only tokens defined
- Shadow: `paper-shadow 0 24px 40px -20px #000` matches DESIGN.md exactly
- Fonts: Geist Variable (UI) and Geist Mono Variable (mono), self-hosted via fontsource
- Routes: none yet (Phase 0 is scaffold only — single placeholder page)
- Dependencies: all in STACK.md; no unlisted packages
- Animations: none yet (Phase 0 is scaffold only)

### Quality gates after removals

- `pnpm typecheck`: 0 errors ✔
- `pnpm lint` (eslint + depcruise): 0 violations, 32 modules cruised ✔
- `pnpm test`: 6/6 tests passed ✔


## Phase 1: Server Ledger and Sync Engine

Status: Completed
Date: 2026-10-09

### Acceptance Criteria Verification

1. **Database Schema & DDL:**
   - Tables created with strict constraints:
     - `products` (sku PK, name, price_paise int, tax_bp int, barcode unique, opening_stock int)
     - `events` (server_seq BIGSERIAL PK, event_id text UNIQUE, terminal_id, terminal_seq int, type, payload jsonb, client_ts, received_at)
     - `stock_balance` (sku PK references products, qty int)
     - `exceptions` (id BIGSERIAL PK, sku, event_id, qty_after, created_at)
     - `dead_letters` (event_id PK, reason, raw jsonb)
     - `alerts` (id BIGSERIAL PK, sku, qty, created_at, delivered bool)

2. **Seeding Script (`scripts/seed.py`):**
   - 24 realistic FMCG products seeded with computed valid EAN-13 barcodes using GS1 prefix 8901234 and algorithmic check-digit modulo-10 calculation.
   - Command: `python scripts/seed.py` -> `Seeded 24 products.`

3. **FastAPI Endpoints Implemented:**
   - `GET /health` -> 200 OK with `{"status":"ok","version":"0.1.0"}`
   - `GET /catalog` -> Returns all 24 products with current stock balances
   - `POST /sync/push` -> Batch up to 50 events; per-event SAVEPOINT; INSERT ON CONFLICT DO NOTHING RETURNING; updates stock in sorted-SKU order; returns `{event_id, status: applied|duplicate|rejected, server_seq}`; records exceptions when balance < 0; records alerts when balance crosses low-stock threshold downward; records dead_letters on malformed events
   - `GET /sync/pull?since=<server_seq>&terminal_id=<terminal_id>` -> Returns events from other terminals, stock balances snapshot, as_of_server_seq, and own_applied_ids
   - `GET /audit` -> Verifies conservation (opening - sold + received == balance for every SKU), checks no duplicate event_id, checks no server_seq gaps, returns `{"status":"PASS"}`
   - `GET /ledger` -> Returns compact state for Stage panel (event count, duplicates rejected, balances, exceptions, dead letters, alerts)
   - `POST /admin/reset` -> Truncates data tables with X-Admin auth check

4. **Pytest Suite (`server/tests/test_sync.py` & `server/tests/test_health.py`):**
   - Command: `python -m pytest tests/ -v`
   - Output:
     ```
     tests/test_health.py::test_health_endpoint PASSED                        [ 14%]
     tests/test_sync.py::test_a_concurrent_duplicate_apply_once PASSED        [ 28%]
     tests/test_sync.py::test_b_concurrent_sell_last_unit PASSED              [ 42%]
     tests/test_sync.py::test_c_malformed_event_does_not_block PASSED         [ 57%]
     tests/test_sync.py::test_d_audit_passes_after_workload PASSED            [ 71%]
     tests/test_sync.py::test_e_pull_pagination_no_gaps PASSED                [ 85%]
     tests/test_sync.py::test_f_concurrent_multi_terminal_no_deadlock PASSED  [100%]

     ============================== 7 passed in 3.45s ===============================
     ```

5. **Linter & Typechecks:**
   - `ruff check scripts/ server/`: All checks passed! (0 errors)
   - `mypy --strict app/ tests/`: Success: no issues found in 7 source files (checked in server)
   - `mypy --strict scripts/seed.py`: Success: no issues found in 1 source file

6. **OpenAPI TypeScript Generation:**
   - Command: `bash scripts/generate-api-types.sh`
   - Output: `openapi-typescript 7.13.0 -> packages/core/src/api-types.ts`
   - `pnpm typecheck` & `pnpm lint` across monorepo: PASSED (0 errors, 32 modules cruised, 0 boundary violations).


## Phase 1 Hardening: Sequence Integrity, Race Elimination, and Security

Status: Completed
Date: 2026-10-09

### Summary of Changes & Architectural Rationale

To eliminate sequence holes and race conditions in concurrent syncing, we introduced a PostgreSQL transaction-scoped advisory lock (`pg_advisory_xact_lock(42424242)`) on `/sync/push` and replaced volatile sequence generation (`BIGSERIAL`/`nextval`) with a dedicated transactional counter row in `server_sequence` (documented in `docs/adr/0014-sync-push-advisory-lock-gapless-server-seq.md`). In standard PostgreSQL, sequence generators increment eagerly and never roll back, meaning duplicate submissions (`ON CONFLICT DO NOTHING`) and rejected events inside aborted savepoints permanently burn sequence numbers, causing gap check failures in `/audit`; furthermore, concurrent transactions committing out of sequence order previously allowed pullers to advance cursors past uncommitted earlier events, skipping events permanently. Under the hardened architecture, events are verified for existence first, `server_seq` is strictly commit-ordered and gapless, and pull cursor pagination is completely deterministic without skips or repeats. Additionally, `/admin/reset` now strictly returns HTTP 403 for missing headers or empty/unset `ADMIN_SECRET` environment variables, the async connection pool instruments simultaneous connections with a capacity of 20 (`TrackedAsyncConnectionPool`), and GitHub Actions CI runs the server test suite against a real PostgreSQL 16 service container.

### Acceptance Criteria Verification

1. **New Tests Added & Verified:**
   - `server/tests/test_sync.py::test_sequence_integrity_with_duplicates_and_rollback`:
     Pushes 1 valid event, 50 duplicates of that event, 1 malformed event (savepoint rollback), and 1 subsequent event, then verifies `/audit` returns `status: PASS` with `seq_gaps: []`.
   - `server/tests/test_sync.py::test_pull_cursor_race`:
     Runs 40 concurrent pushes while a concurrent puller loop pages `/sync/pull?since=<cursor>`, asserting zero skips, zero repeats, and strictly monotonic consecutive sequences.
   - `server/tests/test_admin.py::test_admin_reset_missing_header`: Verifies missing `X-Admin` returns 403.
   - `server/tests/test_admin.py::test_admin_reset_wrong_header`: Verifies invalid `X-Admin` returns 403.
   - `server/tests/test_admin.py::test_admin_reset_correct_header`: Verifies valid `X-Admin` returns 204.
   - `server/tests/test_admin.py::test_admin_reset_empty_or_unset_env`: Verifies empty or unset `ADMIN_SECRET` always returns 403.

2. **Real Pytest Execution Output (13 passed):**
   - Command: `python -m pytest server/tests/ -v -s`
   - Output:
     ```
     server/tests/test_admin.py::test_admin_reset_missing_header PASSED
     server/tests/test_admin.py::test_admin_reset_wrong_header PASSED
     server/tests/test_admin.py::test_admin_reset_correct_header PASSED
     server/tests/test_admin.py::test_admin_reset_empty_or_unset_env PASSED
     server/tests/test_health.py::test_health_endpoint PASSED
     server/tests/test_sync.py::test_a_concurrent_duplicate_apply_once 
     [test_a] Peak simultaneous in-flight requests: 50 | Peak simultaneous DB connections: 3 (pool max_size: 20)
     PASSED
     server/tests/test_sync.py::test_b_concurrent_sell_last_unit PASSED
     server/tests/test_sync.py::test_c_malformed_event_does_not_block PASSED
     server/tests/test_sync.py::test_d_audit_passes_after_workload PASSED
     server/tests/test_sync.py::test_e_pull_pagination_no_gaps PASSED
     server/tests/test_sync.py::test_f_concurrent_multi_terminal_no_deadlock 
     [test_f] Peak simultaneous in-flight requests: 200 | Peak simultaneous DB connections: 3 (pool max_size: 20)
     PASSED
     server/tests/test_sync.py::test_sequence_integrity_with_duplicates_and_rollback PASSED
     server/tests/test_sync.py::test_pull_cursor_race PASSED

     ============================== 13 passed in 8.44s ==============================
     ```

3. **Concurrency Honesty Check (Analysis of Observed Peak Connections):**
   - In `/sync/push`, the DB connection is acquired at line 268 (`async with pool.connection() as conn:`) *before* `pg_advisory_xact_lock` is executed on line 270 (`await conn.execute("SELECT pg_advisory_xact_lock(%s)", ...)`).
   - Under real uvicorn over TCP sockets with `asyncio.gather`, client in-flight request concurrency reaches **50 simultaneous requests** in test (a) and **200 simultaneous requests** in test (f).
   - However, the observed peak *checkout* on the connection pool remains low (~3-14 connections) because `psycopg_pool` defaults to `min_size=2` and grows dynamically: each duplicate request holds its advisory lock for under a millisecond, completing and returning its connection back to the pool faster than the pool background worker spawns all 20 connections.
   - The test suite now runs real uvicorn servers via `UvicornTestServer` over TCP, genuinely overlapping requests and asserting that simultaneous in-flight requests reach at least 20 (measuring 50 in test (a) and 200 in test (f)).

4. **Code Quality Gates:**
   - `ruff check scripts/ server/`: All checks passed! (0 errors).
   - `mypy --strict server/app/ server/tests/ scripts/seed.py`: Success: no issues found in 9 source files.
   - `pnpm typecheck`: 0 errors across all 3 workspace projects.
   - `pnpm lint`: 0 violations across 32 modules cruised.
   - `pnpm test`: 6 passed across 3 test files.
   - CI Workflow (`.github/workflows/ci.yml`): `postgres:16-alpine` service container added with healthcheck and `DATABASE_URL`.


