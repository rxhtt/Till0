R1 / TERMINAL SELECT: two large buttons T1 and T2. Query ?terminal=T1 skips this. Nothing else on the screen.
R2 /register:
  Status rail: terminal chip; Sync Pulse with 'N queued'; 'last commit N ms' in mono (real measurement); Printer chip (SIMULATED | USB | SERIAL | BLUETOOTH | DISCONNECTED); Scanner chip (ARMED; flashes red with the code on an unknown barcode).
  Printer chip click opens a small popover with three actions: Connect USB, Connect Serial/Bluetooth, Use virtual printer.
  Product Wall (7 of 12 columns): search input and 24 product tiles showing name, price in rupees, stock in mono. Stock at or below 5 is amber; at or below 0 is red. Tap adds 1.
  The Tape (5 of 12 columns): line items with qty -/+ and remove, line total, subtotal, inclusive-tax breakdown, large total, PAY button.
  PAY opens a tender sheet: Cash (received input, change shown) or UPI (mark received). Complete sale -> print -> tear animation -> empty Tape. No confirmation dialogs anywhere.
  Keys: scans always add items; / focuses search; Cmd/Ctrl+K opens the palette.
  Virtual printer output appears in a right slide-over 'Paper' with a HEX toggle.
R3 /stage (demo screen): two iframes (T1 left, T2 right), a Server Ledger panel (live stock for changed SKUs, event count, duplicates rejected, exceptions, dead letters, alerts), and the Chaos Drawer.
  Chaos buttons (exactly these): Cut T1 net, Cut T2 net, Drop 30% of acks, Duplicate every request, Slow 3s, Reload T1 mid-sync, Disconnect printer, Burst-scan 25, Mash PAY x200, Spam qty x500, Sell last unit on both, Run 60s seeded chaos, Run audit.
R4 Palette commands: X-report (local, works offline), Z-report (server, shows 'Needs connection' when offline).
NOT INCLUDED: auth, settings, customers, discounts, returns UI, multi-store, theme toggle, any admin UI.
