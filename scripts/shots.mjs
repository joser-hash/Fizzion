import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => window.__fizzion, null, { timeout: 10000 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'scripts/shot-menu.png' });

await page.mouse.click(195, 420);
await page.waitForTimeout(2500);
await page.screenshot({ path: 'scripts/shot-play.png' });

// Grow the orb to show pips + instability arc.
await page.evaluate(async () => {
  const { engine } = window.__fizzion;
  const eat = (color) => {
    engine.particles.push({
      x: engine.orb.x, y: engine.orb.y, vx: 0, vy: 0, color, phase: 0,
      state: 'attract', ax: engine.orb.x, ay: engine.orb.y, attractT: 1,
    });
    return new Promise((r) => setTimeout(r, 50));
  };
  for (const c of ['#00cfff', '#00cfff', '#ffd500']) await eat(c);
  engine.orb.mass = 14;
  engine.stability = 0.25; // critical: decayed sputtering portal + vignette
  engine.comboHeat = 30; // hot combo ambience
  engine.portal.minMass = 6; // min-mass request label
});
await page.waitForTimeout(500);
await page.screenshot({ path: 'scripts/shot-instability.png' });

// Damage ghost: force a fresh stability drop and catch the red ghost fading.
await page.evaluate(() => {
  const { engine } = window.__fizzion;
  engine.stability = 0.9;
});
await page.waitForTimeout(600); // let the display catch up
await page.evaluate(() => {
  window.__fizzion.engine.stability = 0.55;
});
await page.waitForTimeout(250);
await page.screenshot({ path: 'scripts/shot-damage-ghost.png' });

// Pure request visuals.
await page.evaluate(() => {
  const { engine } = window.__fizzion;
  engine.stability = 1;
  engine.portal.requestType = 'pure';
  engine.portal.minMass = 0;
  engine.portal.timeLeft = 20;
  engine.portal.duration = 20;
});
await page.waitForTimeout(300);
await page.screenshot({ path: 'scripts/shot-pure.png' });

// Pip thief hazard closing in: jittery red ring + orb proximity rim flicker.
await page.evaluate(() => {
  const { engine, CONFIG } = window.__fizzion;
  CONFIG.hazardSpeed = 0; // freeze it in place for the shot
  engine.orb.x = 195;
  engine.orb.y = 560;
  engine.orb.vx = 0;
  engine.orb.vy = 0;
  engine.hazards.push({
    x: 195 + 80, y: 560 - 30, vx: 0, vy: 0,
    state: 'hunting', stateT: 0, life: 30, phase: 2,
  });
});
await page.waitForTimeout(350);
await page.screenshot({ path: 'scripts/shot-hazard.png' });
await page.evaluate(() => {
  window.__fizzion.engine.hazards.length = 0;
});

// Collapse the portal -> Second Wind offer.
await page.evaluate(() => {
  window.__fizzion.engine.score = 1240;
  window.__fizzion.engine.portal.requestType = 'normal';
  window.__fizzion.engine.stability = 0.01;
  window.__fizzion.engine.portal.timeLeft = 0.05;
});
await page.waitForFunction(
  () => window.__fizzion.useGameStore.getState().phase === 'revive',
  null,
  { timeout: 8000 },
);
await page.waitForTimeout(600);
await page.screenshot({ path: 'scripts/shot-revive.png' });

// Decline -> results screen.
await page.evaluate(() => {
  window.__fizzion.engine.abandonRevive();
});
await page.waitForTimeout(1200);
await page.screenshot({ path: 'scripts/shot-results.png' });

// Shop modal.
await page.evaluate(() => {
  window.__fizzion.useGameStore.setState({ sparks: 640 });
});
await page.getByText('Shop', { exact: true }).click({ force: true }); // pulses while FTUE is fresh
await page.waitForTimeout(500);
await page.screenshot({ path: 'scripts/shot-shop.png' });
await page.getByText('CLOSE').click();
await page.waitForTimeout(400);

// Settings modal.
await page.getByLabel('Settings').click();
await page.waitForTimeout(500);
await page.screenshot({ path: 'scripts/shot-settings.png' });

await browser.close();
console.log('done');
