/* Automated smoke test: drives a full round in a headless mobile viewport. */
import { chromium } from 'playwright';

const URL = 'http://localhost:5173/';
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(URL);
await page.waitForFunction(() => window.__fizzion, null, { timeout: 10000 });

check('start screen shows TAP TO PLAY', await page.getByText('TAP TO PLAY').isVisible());
check('canvas present', (await page.locator('canvas').count()) === 1);

// Settings: open from the menu gear, verify contents, flip toggles.
await page.getByLabel('Settings').click();
await page.waitForTimeout(300);
check('settings modal opens from menu', await page.getByText('SETTINGS').isVisible());
check('version shown', await page.getByText(/FIZZION v\d+\.\d+\.\d+/).isVisible());
const privacyHref = await page
  .getByText('Privacy Policy')
  .getAttribute('href')
  .catch(() => null);
check(
  'privacy policy link present',
  privacyHref === 'https://infinitygames.io/privacy-policy/',
  `href=${privacyHref}`,
);
const flagsBefore = await page.evaluate(() => {
  const s = window.__fizzion.useGameStore.getState();
  return { muted: s.muted, music: s.music, haptics: s.haptics };
});
await page.getByRole('switch').first().click(); // sound
await page.getByRole('switch').nth(1).click(); // music
await page.getByRole('switch').nth(2).click(); // haptics
const flagsAfter = await page.evaluate(() => {
  const s = window.__fizzion.useGameStore.getState();
  return { muted: s.muted, music: s.music, haptics: s.haptics };
});
check(
  'SFX + music + haptics toggles flip store state',
  flagsAfter.muted === !flagsBefore.muted &&
    flagsAfter.music === !flagsBefore.music &&
    flagsAfter.haptics === !flagsBefore.haptics,
  JSON.stringify(flagsAfter),
);
// Music off must silence the player (it may still be mid-fade here).
await page.waitForTimeout(500);
check(
  'music toggle off stops the player',
  await page.evaluate(() => !window.__fizzion.music.getMusicState().playing),
);
await page.getByRole('switch').first().click(); // restore sound
await page.getByRole('switch').nth(1).click(); // restore music
await page.getByRole('switch').nth(2).click(); // restore haptics
await page.getByText('CLOSE').click();
await page.waitForTimeout(300);
check(
  'settings closes without starting a round',
  await page.evaluate(() => window.__fizzion.useGameStore.getState().phase === 'menu'),
);

// Make the run die quickly: fast-expiring portals with brutal drain.
await page.evaluate(() => {
  const { CONFIG } = window.__fizzion;
  CONFIG.portalTime = 2;
  CONFIG.portalTimeMin = 2;
  CONFIG.stabilityDrainExpire = 0.5;
  CONFIG.stabilityRestoreDelivery = 0;
});

// Tap to start.
await page.locator('canvas').tap({ force: true });
await page.mouse.click(195, 420);
await page.waitForTimeout(300);
const phase1 = await page.evaluate(() => window.__fizzion.useGameStore.getState().phase);
check('round starts after tap', phase1 === 'playing', `phase=${phase1}`);

// Background music: the start gesture kicks off the intro+loop source.
await page
  .waitForFunction(() => window.__fizzion.music.getMusicState().hasSource, null, {
    timeout: 10000,
  })
  .catch(() => {});
const music = await page.evaluate(() => window.__fizzion.music.getMusicState());
check(
  'music playing after the start gesture',
  music.playing && music.hasSource && music.contextState === 'running',
  JSON.stringify(music),
);
check(
  'music loops the main section only (intro excluded)',
  music.loopStart !== null && Math.abs(music.loopStart - 23.417) < 0.01 &&
    music.loopEnd > music.loopStart,
  `loopStart=${music.loopStart?.toFixed(3)} loopEnd=${music.loopEnd?.toFixed(1)}`,
);
const musicStopStart = await page.evaluate(async () => {
  const { music: m } = window.__fizzion;
  m.stopMusic();
  await new Promise((r) => setTimeout(r, 500)); // fade-out + teardown
  const stopped = m.getMusicState();
  await m.startMusic(); // buffer is cached: resolves quickly
  const restarted = m.getMusicState();
  return { stopped, restarted };
});
check(
  'music stop fades out and releases the source; restart replays cleanly',
  !musicStopStart.stopped.playing && !musicStopStart.stopped.hasSource &&
    musicStopStart.restarted.playing && musicStopStart.restarted.hasSource,
  JSON.stringify(musicStopStart),
);

check(
  'FTUE coach steer step visible in first round',
  await page.getByText('Swipe anywhere to push your orb').isVisible().catch(() => false),
);

// Swipe a few times and force-feed the orb via engine internals check:
// verify particle collection raises mass through real proximity by
// teleporting is not exposed; instead swipe around and sample state.
for (let i = 0; i < 6; i++) {
  const x = 100 + Math.random() * 200;
  const y = 300 + Math.random() * 300;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + (Math.random() - 0.5) * 250, y + (Math.random() - 0.5) * 250, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

check(
  'coach advanced past the steer step after swiping',
  !(await page.getByText('Swipe anywhere to push your orb').isVisible().catch(() => false)),
);

const mid = await page.evaluate(() => {
  const { engine, useGameStore } = window.__fizzion;
  return { hud: { ...engine.hud }, phase: useGameStore.getState().phase };
});
check('run time counting up', mid.hud.runTime > 1, `runTime=${mid.hud.runTime.toFixed(1)}`);
check(
  'stability draining on expiries',
  mid.hud.stability < 1,
  `stability=${mid.hud.stability.toFixed(2)}`,
);

// In-game settings: the HUD gear pauses the run; closing resumes it.
await page.getByLabel('Settings').click();
await page.waitForTimeout(300);
check('in-game settings opens from HUD gear', await page.getByText('SETTINGS').isVisible());
const tPause0 = await page.evaluate(() => window.__fizzion.engine.hud.runTime);
await page.waitForTimeout(600);
const tPause1 = await page.evaluate(() => window.__fizzion.engine.hud.runTime);
check(
  'engine paused while settings open',
  Math.abs(tPause1 - tPause0) < 0.05,
  `t0=${tPause0.toFixed(2)} t1=${tPause1.toFixed(2)}`,
);
await page.getByText('CLOSE').click();
await page.waitForTimeout(500);
const tResume = await page.evaluate(() => window.__fizzion.engine.hud.runTime);
check(
  'run resumes after closing settings',
  tResume > tPause1 + 0.2,
  `paused=${tPause1.toFixed(2)} resumed=${tResume.toFixed(2)}`,
);

// Wait for the portal to collapse (stability hits 0) -> Second Chance offer.
await page.waitForFunction(
  () => window.__fizzion.useGameStore.getState().phase === 'revive',
  null,
  { timeout: 15000 },
);
check('Second Chance offer on death', await page.getByText('SECOND CHANCE').isVisible());

// Accept: watch the rewarded ad, claim, and the run resumes.
// (force: the button has an infinite pulse animation, never "stable")
await page.getByText('SECOND CHANCE').click({ force: true });
check('revive rewarded ad opens', await page.getByText('AD (mock)').isVisible());
await page.waitForTimeout(3300);
await page.getByText('CLAIM REWARD').click();
await page.waitForTimeout(300);
const revived = await page.evaluate(() => {
  const { engine, useGameStore } = window.__fizzion;
  return { phase: useGameStore.getState().phase, stability: engine.hud.stability };
});
check(
  'revive resumes the run with restored stability',
  revived.phase === 'playing' && revived.stability > 0.3,
  JSON.stringify(revived),
);

// Second death: revive spent, straight to results.
await page.waitForFunction(
  () => window.__fizzion.useGameStore.getState().phase === 'results',
  null,
  { timeout: 15000 },
);
check('results screen after second death (no second offer)', true);
check('PORTAL COLLAPSED headline', await page.getByText('PORTAL COLLAPSED').isVisible());
check('survived time shown', await page.getByText(/SURVIVED \d+:\d\d/).isVisible());
check('PLAY AGAIN visible', await page.getByText('PLAY AGAIN').isVisible());
check(
  'first-results Sparks explainer visible',
  await page.getByText('Sparks are yours to keep').isVisible().catch(() => false),
);
check(
  'no banner placeholder on results',
  !(await page.getByText('BANNER 320x50 (mock)').isVisible().catch(() => false)),
);
check('shop button visible', await page.getByText('Shop', { exact: true }).isVisible());

// Shop: open from results, buy an upgrade, close.
await page.evaluate(() => window.__fizzion.useGameStore.setState({ sparks: 1000 }));
await page.getByText('Shop', { exact: true }).click({ force: true }); // pulses while FTUE is fresh
await page.waitForTimeout(300);
check('shop modal opens', await page.getByText('Reinforced Portal').isVisible());
await page.getByText('200', { exact: true }).click();
await page.waitForTimeout(200);
const shopState = await page.evaluate(() => {
  const s = window.__fizzion.useGameStore.getState();
  return { sparks: s.sparks, level: s.upgrades.reinforced_portal ?? 0 };
});
check(
  'shop purchase deducts Sparks and levels up',
  shopState.sparks === 800 && shopState.level === 1,
  JSON.stringify(shopState),
);
await page.getByText('CLOSE').click();
await page.waitForTimeout(400);
check(
  'shop closes',
  !(await page.getByText('Reinforced Portal').isVisible().catch(() => false)),
);

const state1 = await page.evaluate(() => {
  const s = window.__fizzion.useGameStore.getState();
  return { roundsPlayed: s.roundsPlayed, sparks: s.sparks, lastRound: s.lastRound };
});
check('roundsPlayed incremented', state1.roundsPlayed >= 1, `rounds=${state1.roundsPlayed}`);

// Rewarded: Color Lock offer -> mock ad modal -> claim.
const clBtn = page.getByText('Color Lock — free 5s freeze next round');
if (await clBtn.isVisible()) {
  await clBtn.click();
  check('mock ad modal opens', await page.getByText('AD (mock)').isVisible());
  await page.waitForTimeout(3300);
  const claim = page.getByText('CLAIM REWARD');
  check('claim appears after countdown', await claim.isVisible());
  await claim.click();
  const charges = await page.evaluate(
    () => window.__fizzion.useGameStore.getState().colorLockCharges,
  );
  check('color lock charge granted', charges === 1, `charges=${charges}`);
} else {
  check('color lock offer visible', false);
}

// Persistence: sparks/bestScore survive reload.
await page.waitForTimeout(700); // debounce save
const before = await page.evaluate(() => {
  const s = window.__fizzion.useGameStore.getState();
  return { sparks: s.sparks, bestScore: s.bestScore, roundsPlayed: s.roundsPlayed };
});
await page.reload();
await page.waitForFunction(() => window.__fizzion, null, { timeout: 10000 });
const after = await page.evaluate(() => {
  const s = window.__fizzion.useGameStore.getState();
  return { sparks: s.sparks, bestScore: s.bestScore, roundsPlayed: s.roundsPlayed };
});
check(
  'persistence across refresh',
  JSON.stringify(before) === JSON.stringify(after),
  `${JSON.stringify(before)} vs ${JSON.stringify(after)}`,
);

const dueResultsState = {
  roundsPlayed: 5, roundsSinceInterstitial: 5, rewardedThisRun: false, phase: 'results',
  lastRound: { score: 100, bestChain: 1, sparksEarned: 5, deliveries: 1, overloads: 0, duration: 42, doubled: false, newBestScore: false },
};

// Remove Ads: no interstitial even when one is due.
await page.evaluate((state) => {
  window.__fizzion.useGameStore.setState({ ...state, adsRemoved: true });
}, dueResultsState);
await page.waitForTimeout(300);
await page.getByText('PLAY AGAIN').click();
await page.waitForTimeout(400);
check(
  'no interstitial when ads removed',
  !(await page.getByText('Interstitial').isVisible().catch(() => false)),
);
const phaseAdFree = await page.evaluate(() => window.__fizzion.useGameStore.getState().phase);
check('round starts immediately when ad-free', phaseAdFree === 'playing', `phase=${phaseAdFree}`);
check(
  'no FTUE coach after the first run (ftueDone)',
  !(await page.getByText('Swipe anywhere to push your orb').isVisible().catch(() => false)),
);

// Courtesy skip: a completed rewarded ad this run suppresses the interstitial.
await page.evaluate((state) => {
  window.__fizzion.useGameStore.setState({ ...state, adsRemoved: false, rewardedThisRun: true });
}, dueResultsState);
await page.getByText('PLAY AGAIN').click();
await page.waitForTimeout(400);
check(
  'interstitial courtesy-skipped after a rewarded ad',
  !(await page.getByText('Interstitial').isVisible().catch(() => false)),
);

// Interstitial cadence: simulate being due, press PLAY AGAIN, expect ad.
await page.evaluate((state) => {
  window.__fizzion.useGameStore.setState({ ...state, adsRemoved: false });
}, dueResultsState);
await page.getByText('PLAY AGAIN').click();
await page.waitForTimeout(400);
check('interstitial shows when due', await page.getByText('Interstitial').isVisible());
await page.waitForTimeout(3300);
await page.getByText('CLOSE').click();
await page.waitForTimeout(400);
const phase2 = await page.evaluate(() => window.__fizzion.useGameStore.getState().phase);
check('round starts after interstitial', phase2 === 'playing', `phase=${phase2}`);

// Debug panel via keyboard.
await page.keyboard.press('d');
check('debug panel opens with D', await page.getByText('DEBUG').isVisible());

// FPS sample during play.
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      const loop = () => {
        frames++;
        if (performance.now() - start < 2000) requestAnimationFrame(loop);
        else resolve(frames / 2);
      };
      requestAnimationFrame(loop);
    }),
);
check('fps sample reasonable', fps > 30, `${fps.toFixed(0)} fps (headless)`);

// Reset game data: two-tap confirm wipes the save and reloads.
await page.keyboard.press('d'); // close debug panel
await page.evaluate((state) => {
  window.__fizzion.useGameStore.setState(state);
}, dueResultsState);
await page.waitForTimeout(300);
await page.getByLabel('Settings').click();
await page.waitForTimeout(300);
await page.getByText('RESET GAME DATA').click();
check('reset asks for confirmation', await page.getByText('TAP AGAIN TO CONFIRM').isVisible());
await Promise.all([
  page.waitForNavigation(),
  page.getByText('TAP AGAIN TO CONFIRM').click(),
]);
await page.waitForFunction(() => window.__fizzion, null, { timeout: 10000 });
const wiped = await page.evaluate(() => ({
  save: localStorage.getItem('fizzion_save'),
  rounds: window.__fizzion.useGameStore.getState().roundsPlayed,
}));
check(
  'reset wipes the save and reloads fresh',
  wiped.save === null && wiped.rounds === 0,
  JSON.stringify(wiped),
);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
