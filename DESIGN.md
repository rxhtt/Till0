THEME: Thermal Noir. A dark checkout where the paper receipt is the hero, like industrial hardware. Not a SaaS dashboard.
COLORS: bg-0 #0A0A0B | bg-1 #121214 | bg-2 #1A1A1D | line #2A2A2F | text #ECECEE | dim #8B8B94 | paper #F2EFE6 | ink #141414 | amber #FFB224 (primary action, pending) | green #3DDC84 (synced) | red #FF5A52 (error, exception)
TYPE: UI font Geist Variable; numerals and receipt Geist Mono Variable with tabular-nums. Self-host via @fontsource packages (offline-first: NO CDN fonts). If Geist packages are unavailable, use JetBrains Mono Variable for mono and system-ui for UI and log it in DECISIONS.md. Sizes 12/14/16/20/28/48 only. Weights 400 and 600 only.
SHAPE: radius 4 and 12 only. 1px borders in line color. Only shadow allowed: paper-shadow 0 24px 40px -20px #000 on the Tape.
SPACING: 4px scale. Register touch targets at least 56px.
MOTION (motion library): 120ms UI, 240ms panels, 480ms paper feed. Easing cubic-bezier(0.2,0.8,0.2,1). Respect prefers-reduced-motion. RULE: animation is cosmetic. State changes first, animation after. No animation may delay or block the next user action.
SIGNATURE ELEMENTS (only these): The Tape, Sync Pulse, Offline Stamp, Command Palette, Chaos Drawer.
  The Tape: cart as a warm thermal-paper strip. Each scan prints a line with a paper-feed slide, a tick sound synthesized with WebAudio (no audio files), rolling tabular digits on the total. After payment the strip tears away while the next sale can already start.
  Sync Pulse: ECG-style SVG line in the status rail. Flat green when synced. Offline: amber blips, one per queued event. On reconnect the queue flushes as a visible burst and counts down to zero.
  Offline Stamp: rotated 'OFFLINE / QUEUED' ink stamp on the Tape while the sale is queued.
  Command Palette: cmdk, keyboard-first.
  Chaos Drawer: looks like devtools, on the Stage screen only.
FORBIDDEN: gradients, glass blur, glow, emoji, illustrations, purple or indigo accents, pills other than 8px status dots, card-inside-card nesting, spinners on the checkout path.
