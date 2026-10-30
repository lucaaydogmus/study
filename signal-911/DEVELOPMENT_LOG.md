# Development Log
## Stage 0 — Foundation (done)
- Vite/React/TS/Zustand/Lucide/Vitest scaffold in `signal-911/`.
- `src/sim`: seeded RNG (mulberry32), game clock (pause, 1/2/4×, step cap), versioned guarded save (load/write/migrate).
- `src/store/game.ts`: Zustand store (clock, settings, save status).
- `src/ui/App.tsx` + `styles/theme.css`: palette tokens, layout shell (top bar, left, map, right, bottom), working pause/speed/volume/mute, shortcuts (Space, 1/2/3, +, M).
- 8 Vitest tests pass; production build passes; smoke-checked at 1440×900, 1920×1080, 3440×1440 with no console errors.
