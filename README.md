# Fizzion

A neon arcade prototype: steer a glowing orb, eat colored particles, match the portal's requested color, and chain deliveries before you overload. Mobile web, portrait-only, built to be Capacitor-wrapped later.

## Run

```bash
npm install
npm run dev
```

Open the printed URL on a phone (or a phone-sized browser window) in portrait.

## How to play

First run includes a light FTUE: coach lines advance as you steer, eat, and deliver, and the first results screen points you at Sparks and the shop (shown once, persisted).

- Swipe/drag to impulse the orb (drag direction = force direction).
- Eating a particle adds mass and a colored pip (the orb carries its last 3).
- The orb's color is the majority of its pips. Touch the portal while matching its requested color to deliver: score = mass x 10 x chain.
- The chain is a streak: it expires after 10s without a delivery (the HUD chain text blinks when time is running out), and also breaks on overload or a wasted matching expiry.
- Mass past 8 builds instability; at 20 the orb overloads, scattering its mass as re-collectible particles (they vanish after 3 s) and draining stability.
- Endless runs: the stability bar (top edge) is your life. Missed portal requests and overloads drain it, deliveries restore it — at zero the portal collapses and the run ends.
- Difficulty ramps over ~3 minutes: portal timers shrink and requests start demanding minimum mass ("6+"), pushing you into the instability zone.
- Request variety kicks in as you survive: **rush** requests (fast-spinning ring, "2x") have half the time for double score; **pure** requests (triple ring, "PURE") demand all 3 pips in the request color for triple score and a double stability restore.
- Past 90 s (and 5 deliveries) the **portal relocates** every few deliveries — it collapses and re-opens somewhere new, more often as difficulty ramps. Expired requests never move it, and a Second Chance revive always does.
- **Pip thief raids** start around a minute in: a jittery red ring flickers in, hunts the orb for 12-18 s, then dissipates — with a 20-40 s breather before the next raid (two thieves per raid late-run). On contact it steals your newest pip (mass −1) and flees. It never touches stability or the chain — outrun or outlast it. The orb's rim flickers red as one closes in, and flashes red when robbed.
- Bigger deliveries hit harder: BIG / HUGE / COLOSSAL celebrations, and fast strings of heavy deliveries build combo heat.
- Deliveries also earn Sparks (persisted). Spend them in the **Shop** (results screen) on permanent upgrades: Reinforced Portal, Magnet Core, Dense Shell, Lock Battery.
- When the portal collapses you get one **Second Chance** per run: watch a rewarded ad within 5 s to restore 50% stability and keep going.
- Mock IAP: Sparks packs and Remove Ads are purchasable from the shop. Remove Ads kills interstitials; a completed rewarded ad also courtesy-skips the next interstitial.
- Settings (gear button on the menu and results screens): SFX and haptics toggles, app version, privacy policy link, and a two-tap "reset game data" that wipes the save.

## Tech

- React 19 + Vite + TypeScript, Tailwind CSS v4, Framer Motion (UI only), Zustand.
- The entire simulation runs imperatively on a single `<canvas>` in `src/lib/engine/` (no React in the game loop). All visuals are procedural; all sound effects are synthesized with the Web Audio API. The only media asset is the background music track (`public/audio/`), played via a Web Audio `AudioBufferSourceNode` so the intro plays once and the main section loops sample-accurately (`src/audio/useGameMusic.ts`).
- All tuning lives in `CONFIG` in `src/lib/constants.ts`.
- Adaptive quality: a governor watches the frame-time average and steps through 3 tiers (render resolution, glow layers, trail density, spark budget) when a device struggles, with hysteresis and a persisted tier so slow phones boot already adapted.
- Ads/IAP are mocked behind the `AdService` / `PurchaseService` interfaces in `src/lib/ads.ts`; real SDKs replace the mocks at wrap time.

## Share / deploy

Every push to `main` auto-deploys to GitHub Pages via `.github/workflows/deploy.yml` — the playable link is `https://<your-username>.github.io/Fizzion/`. One-time setup: repo **Settings → Pages → Source → "GitHub Actions"**. The Vite `base` is `/Fizzion/` for builds only; local dev stays at the root.

## Debug

Press `D` (desktop) or triple-tap the top-left corner (touch) to open the live tuning panel. It shows live fps and the current quality tier, with a manual tier override (0/1/2/auto) for testing.

## Automated checks

With the dev server running on port 5173 (Playwright browsers installed via `PLAYWRIGHT_BROWSERS_PATH=./.pw-browsers npx playwright install chromium-headless-shell`):

```bash
PLAYWRIGHT_BROWSERS_PATH=./.pw-browsers node scripts/smoke.mjs      # full round, ads, persistence
PLAYWRIGHT_BROWSERS_PATH=./.pw-browsers node scripts/mechanics.mjs  # pips, scoring, overload, boosts
PLAYWRIGHT_BROWSERS_PATH=./.pw-browsers node scripts/perf.mjs       # quality governor step-down/up
```
