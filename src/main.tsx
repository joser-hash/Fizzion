import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/oxanium/400.css';
import '@fontsource/oxanium/600.css';
import '@fontsource/oxanium/700.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/900.css';
import './index.css';
import App from './App.tsx';

// Belt-and-braces mobile hardening: block pinch-zoom gestures that the
// viewport meta alone doesn't always stop on iOS. Double-tap zoom and
// pull-to-refresh are handled by touch-action/overscroll-behavior in CSS.
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1) e.preventDefault();
  },
  { passive: false },
);

if (import.meta.env.DEV) {
  // Dev-only handle for automated smoke tests and console tinkering.
  void Promise.all([
    import('./lib/engine/engine'),
    import('./store/gameStore'),
    import('./lib/constants'),
    import('./lib/upgrades'),
    import('./audio/useGameMusic'),
    import('./lib/boosts'),
  ]).then(
    ([
      { engine },
      { useGameStore },
      { CONFIG, GAME_COLORS, UPGRADE_CATALOG },
      { upgradeEffects },
      music,
      boosts,
    ]) => {
      (window as unknown as Record<string, unknown>).__fizzion = {
        engine,
        useGameStore,
        CONFIG,
        GAME_COLORS,
        UPGRADE_CATALOG,
        upgradeEffects,
        music,
        boosts,
      };
    },
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
