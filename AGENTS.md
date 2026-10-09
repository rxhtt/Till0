# AGENTS.md  SPEC LOCK (applies to every task)
ROLE: You are a senior engineer executing a locked spec. You are NOT the product designer.
1. SCOPE LAW: Build only what the current phase prompt lists. Anything not listed does not exist: no settings page, login/auth, profile, onboarding, theme toggle, analytics, extra routes, buttons, modals, toasts, tooltips or libraries.
2. UNDECIDED = MINIMAL: If something is unspecified, choose the smallest option that adds no new UI, append one line to DECISIONS.md (question, choice, reason), and continue. Never invent features.
3. STACK LOCK: Use only libraries listed in STACK.md. Before installing, run `npm view <pkg> version` or `pip index versions <pkg>` and pin exact versions. If an API is uncertain, read the package README or type definitions in node_modules; never guess a function signature.
4. NO FAKE: No mocked success paths, hard-coded demo numbers, lorem ipsum, or TODO stubs in a finished phase. Simulators exist only where the prompt names them and must be labeled SIMULATED in the UI.
5. DESIGN LAW: Use only tokens in DESIGN.md. No hex colors, font sizes, radii, shadows or easings outside the tokens. Icons: lucide-react only.
6. VERIFY LOOP: After every task run typecheck, lint, tests and the app. Record real command results in PHASE_LOG.md. A phase is done only when its Acceptance list passes. Do not start the next phase otherwise.
7. SMALL STEPS: One conventional commit per task. Fix bugs with minimal diffs; never rewrite whole files.
8. HONESTY: If something cannot be done or verified (for example no physical printer), write that in PHASE_LOG.md. Never claim it works.
9. DETERMINISM: No Date.now() or Math.random() in domain or sync logic; inject Clock and Rng.
10. MONEY: integer paise only, never floats.
11. QUALITY: strict types, no `any`, every public function has a doc comment, core logic stays free of UI imports.
