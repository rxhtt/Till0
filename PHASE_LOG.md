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
