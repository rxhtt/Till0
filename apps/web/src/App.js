import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Root Application component for Till0 POS.
 * Shows only a bg-0 page with the word Till0 per Phase 0 specification.
 */
export function App() {
    return (_jsx("main", { className: "min-h-screen bg-bg-0 text-text flex items-center justify-center", children: _jsx("h1", { className: "text-[28px] font-semibold tracking-tight text-text", children: "Till0" }) }));
}
