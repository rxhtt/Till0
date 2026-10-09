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

