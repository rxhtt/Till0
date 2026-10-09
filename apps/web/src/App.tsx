import React from 'react';

/**
 * Root Application component for Till0 POS.
 * Shows only a bg-0 page with the word Till0 per Phase 0 specification.
 */
export function App(): React.JSX.Element {
  return (
    <main className="min-h-screen bg-bg-0 text-text flex items-center justify-center">
      <h1 className="text-[28px] font-semibold text-text">Till0</h1>
    </main>
  );
}
