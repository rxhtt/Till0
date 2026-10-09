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


