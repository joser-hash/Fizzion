/* Quality governor verification.
 *
 * Headless Chromium renders too fast for CDP CPU throttling to force a
 * genuinely low frame rate, so instead of faking a slow device we drive
 * the governor's own thresholds and verify the full mechanism end to end:
 * step-down, reduced-resolution rendering, persistence, step-up with
 * headroom, and the manual override lock. */
import { chromium } from 'playwright';

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

await page.goto('http://localhost:5173/');
await page.waitForFunction(() => window.__fizzion, null, { timeout: 10000 });

// Fresh device: full quality by default.
const initial = await page.evaluate(() => {
  const { engine } = window.__fizzion;
  return { quality: engine.quality, canvasW: document.querySelector('canvas').width };
});
check('starts at full quality', initial.quality === 0, JSON.stringify(initial));

// Start a round (the governor only acts during real play), then make the
// step-down threshold unreachable so any fps counts as "struggling".
await page.mouse.click(195, 420);
await page.waitForTimeout(300);
await page.evaluate(() => {
  const { CONFIG } = window.__fizzion;
  CONFIG.qualityStepDownAfter = 0.4;
  CONFIG.qualityStepDownFps = 1000; // every device is "too slow"
  CONFIG.qualityStepUpFps = 2000;
});
await page.waitForFunction(
  () => window.__fizzion.engine.quality === 2,
  null,
  { timeout: 15000 },
);
const throttled = await page.evaluate(() => {
  const { engine } = window.__fizzion;
  return {
    quality: engine.quality,
    fps: engine.hud.fps,
    persisted: localStorage.getItem('fizzion_quality'),
    canvasW: document.querySelector('canvas').width,
    sparkCap: engine.effects.sparkCap,
  };
});
check(
  'governor steps down to the lowest tier under sustained low fps',
  throttled.quality === 2,
  `tier=${throttled.quality} fps=${throttled.fps.toFixed(0)}`,
);
check(
  'low tier renders at reduced resolution',
  throttled.canvasW < initial.canvasW,
  `${throttled.canvasW} < ${initial.canvasW}`,
);
check('low tier shrinks the spark budget', throttled.sparkCap === 80, `cap=${throttled.sparkCap}`);
check(
  'tier persists to localStorage',
  throttled.persisted === '2',
  `persisted=${throttled.persisted}`,
);

// A reload on the same "device" must boot already adapted.
await page.reload();
await page.waitForFunction(() => window.__fizzion, null, { timeout: 10000 });
const reloaded = await page.evaluate(() => ({
  quality: window.__fizzion.engine.quality,
  canvasW: document.querySelector('canvas').width,
}));
check(
  'persisted tier applies on boot (before any play)',
  reloaded.quality === 2 && reloaded.canvasW < initial.canvasW,
  JSON.stringify(reloaded),
);

// With headroom (real headless fps is high), quality climbs back to full.
await page.mouse.click(195, 420);
await page.waitForTimeout(300);
await page.evaluate(() => {
  const { CONFIG } = window.__fizzion;
  CONFIG.qualityStepUpAfter = 0.6;
});
await page.waitForFunction(
  () => window.__fizzion.engine.quality === 0,
  null,
  { timeout: 15000 },
);
const recovered = await page.evaluate(() => ({
  quality: window.__fizzion.engine.quality,
  fps: window.__fizzion.engine.hud.fps,
  canvasW: document.querySelector('canvas').width,
  persisted: localStorage.getItem('fizzion_quality'),
}));
check(
  'quality climbs back to full with headroom, resolution restored',
  recovered.quality === 0 && recovered.fps > 57 && recovered.canvasW === initial.canvasW,
  `tier=${recovered.quality} fps=${recovered.fps.toFixed(0)} w=${recovered.canvasW}`,
);
check('recovered tier persisted', recovered.persisted === '0', `persisted=${recovered.persisted}`);

// Manual override pins the tier: the governor must stand down even with
// absurdly easy step-up conditions.
const locked = await page.evaluate(async () => {
  const { engine, CONFIG } = window.__fizzion;
  CONFIG.qualityStepUpFps = 1; // would instantly climb if unlocked
  CONFIG.qualityStepUpAfter = 0.2;
  engine.setQuality(2, true);
  await new Promise((r) => setTimeout(r, 1500));
  return { quality: engine.quality, lockedFlag: engine.qualityLocked };
});
check(
  'manual override locks the tier against the governor',
  locked.quality === 2 && locked.lockedFlag,
  JSON.stringify(locked),
);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
