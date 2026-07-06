/* Mechanics verification: pips/majority, delivery scoring, rejection, overload. */
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
await page.mouse.click(195, 420); // start round
await page.waitForTimeout(300);

// Determinism: kill ambient food so tests fully control what the orb eats,
// and block hazard auto-spawns (tested explicitly further down).
await page.evaluate(() => {
  const { engine, CONFIG } = window.__fizzion;
  CONFIG.maxParticles = 0; // stops the periodic cluster top-up
  CONFIG.hazardMaxCount = 0;
  engine.particles.length = 0;
});

// --- Pip FIFO + majority color ---
const pipTest = await page.evaluate(async () => {
  const { engine } = window.__fizzion;
  const orb = engine.orb;
  const eat = (color) => {
    // Plant a particle mid-suck directly on the orb.
    engine.particles.push({
      x: orb.x, y: orb.y, vx: 0, vy: 0, color, phase: 0,
      state: 'attract', ax: orb.x, ay: orb.y, attractT: 1,
    });
    return new Promise((r) => setTimeout(r, 60)); // let a frame consume it
  };
  await eat('#00ff88');
  await eat('#ff2975');
  const twoPips = { pips: [...engine.orb.pips], color: engine.orb.color };
  await eat('#ff2975');
  const majority = { pips: [...engine.orb.pips], color: engine.orb.color, mass: engine.orb.mass };
  await eat('#00cfff'); // FIFO: oldest (#00ff88) pushed out -> pink,pink -> wait no: [pink,pink,cyan]... oldest was green
  const fifo = { pips: [...engine.orb.pips], color: engine.orb.color };
  return { twoPips, majority, fifo };
});
// After eating green then pink: 1-1 tie keeps the previous color, which
// became green on the first pickup.
check(
  'tie between two pips keeps previous color',
  pipTest.twoPips.color === '#00ff88' && pipTest.twoPips.pips.length === 2,
  JSON.stringify(pipTest.twoPips),
);
check(
  'majority color wins (2x pink)',
  pipTest.majority.color === '#ff2975' && pipTest.majority.mass === 4,
  JSON.stringify(pipTest.majority),
);
check(
  'FIFO evicts oldest pip',
  JSON.stringify(pipTest.fifo.pips) === JSON.stringify(['#ff2975', '#ff2975', '#00cfff']) &&
    pipTest.fifo.color === '#ff2975',
  JSON.stringify(pipTest.fifo),
);

// --- FTUE signals: pip count reaches the store snapshot ---
const pipsSignal = await page.evaluate(async () => {
  await new Promise((r) => setTimeout(r, 250)); // let the 10Hz sync tick
  return window.__fizzion.useGameStore.getState().pips;
});
check('HUD snapshot exposes pips', pipsSignal === 3, `pips=${pipsSignal}`);

// --- Rejection (wrong color at portal) ---
const rejection = await page.evaluate(async () => {
  const { engine } = window.__fizzion;
  const portal = engine.portal;
  // Force a mismatch, then teleport the orb into the portal.
  const wrong = ['#00ff88', '#ff2975', '#00cfff', '#ffd500'].find((c) => c !== engine.orb.color);
  portal.color = engine.orb.color === wrong ? '#ffd500' : wrong;
  // Make sure orb color differs from portal
  const before = { score: engine.score, chain: engine.chain };
  engine.orb.x = portal.x;
  engine.orb.y = portal.y;
  engine.orb.vx = 0;
  engine.orb.vy = 0;
  await new Promise((r) => setTimeout(r, 120));
  const v = Math.hypot(engine.orb.vx, engine.orb.vy);
  return { before, after: { score: engine.score, chain: engine.chain }, bounceSpeed: v, rejectFlash: portal.rejectFlash > 0 };
});
check(
  'wrong color: no score, no chain, bounce-back',
  rejection.after.score === rejection.before.score &&
    rejection.after.chain === rejection.before.chain &&
    rejection.bounceSpeed > 100,
  JSON.stringify(rejection),
);

// --- Portal expiry drains stability ---
const expiry = await page.evaluate(async () => {
  const { engine, CONFIG } = window.__fizzion;
  const before = engine.stability;
  engine.portal.timeLeft = 0.01;
  await new Promise((r) => setTimeout(r, 150));
  return { before, after: engine.stability, drain: CONFIG.stabilityDrainExpire };
});
check(
  'portal expiry drains stability',
  Math.abs(expiry.before - expiry.after - expiry.drain) < 0.001,
  JSON.stringify(expiry),
);

// --- Delivery (matching color) ---
const delivery = await page.evaluate(async () => {
  const { engine, CONFIG } = window.__fizzion;
  const portal = engine.portal;
  await new Promise((r) => setTimeout(r, 600)); // reroll anim + reset contact
  engine.orb.x = 195;
  engine.orb.y = 700;
  await new Promise((r) => setTimeout(r, 200));
  portal.color = engine.orb.color; // force a match (orb has pips already)
  portal.minMass = 0;
  const mass = engine.orb.mass;
  const stabilityBefore = engine.stability;
  engine.orb.x = portal.x;
  engine.orb.y = portal.y;
  await new Promise((r) => setTimeout(r, 400)); // hit-stop + celebration
  return {
    mass,
    score: engine.score,
    chain: engine.chain,
    sparks: engine.sparksEarned,
    // Respawned orb may graze an ambient particle before we sample it.
    orbReset: engine.orb.mass <= 3 && engine.orb.pips.length <= 2,
    expectedScore: mass * 10 * 1,
    expectedSparks: Math.ceil((mass * 1) / 2),
    stabilityBefore,
    stabilityAfter: engine.stability,
    restore: CONFIG.stabilityRestoreDelivery,
    comboHeat: engine.comboHeat,
  };
});
check(
  'delivery: score = mass*10*chain, sparks = ceil(mass*chain/2), orb reset',
  delivery.score === delivery.expectedScore &&
    delivery.sparks === delivery.expectedSparks &&
    delivery.chain === 1 &&
    delivery.orbReset,
  JSON.stringify(delivery),
);
const deliveriesSignal = await page.evaluate(async () => {
  await new Promise((r) => setTimeout(r, 250));
  return window.__fizzion.useGameStore.getState().deliveries;
});
check('HUD snapshot exposes deliveries', deliveriesSignal >= 1, `deliveries=${deliveriesSignal}`);

check(
  'delivery restores stability',
  delivery.stabilityAfter > delivery.stabilityBefore &&
    delivery.stabilityAfter - delivery.stabilityBefore <= delivery.restore + 0.001,
  `before=${delivery.stabilityBefore.toFixed(2)} after=${delivery.stabilityAfter.toFixed(2)}`,
);
check(
  'delivery raises combo heat by ~mass',
  delivery.comboHeat > delivery.mass * 0.8 && delivery.comboHeat <= delivery.mass,
  `heat=${delivery.comboHeat.toFixed(1)} mass=${delivery.mass}`,
);

// --- Combo heat decays over time ---
const heatDecay = await page.evaluate(async () => {
  const { engine } = window.__fizzion;
  const h0 = engine.comboHeat;
  await new Promise((r) => setTimeout(r, 1000));
  return { h0, h1: engine.comboHeat };
});
check('combo heat decays', heatDecay.h1 < heatDecay.h0, JSON.stringify(heatDecay));

// --- Chain window: the chain expires without a fresh delivery ---
const chainWindow = await page.evaluate(async () => {
  const { engine, useGameStore } = window.__fizzion;
  engine.chain = 2;
  engine.chainTimeLeft = 0.3;
  const nonceBefore = useGameStore.getState().chainBreakNonce;
  await new Promise((r) => setTimeout(r, 600));
  return {
    chain: engine.chain,
    left: engine.chainTimeLeft,
    broke: useGameStore.getState().chainBreakNonce > nonceBefore,
  };
});
check(
  'chain breaks when the window runs out',
  chainWindow.chain === 0 && chainWindow.left === 0 && chainWindow.broke,
  JSON.stringify(chainWindow),
);

// --- Min-mass request: right color but too small gets rejected ---
const minMass = await page.evaluate(async () => {
  const { engine } = window.__fizzion;
  const portal = engine.portal;
  // Give the orb a color again.
  engine.particles.push({
    x: engine.orb.x, y: engine.orb.y, vx: 0, vy: 0, color: '#00cfff', phase: 0,
    state: 'attract', ax: engine.orb.x, ay: engine.orb.y, attractT: 1,
  });
  await new Promise((r) => setTimeout(r, 100));
  engine.orb.x = 195;
  engine.orb.y = 700;
  await new Promise((r) => setTimeout(r, 300)); // clear portal contact
  portal.color = engine.orb.color;
  portal.minMass = 99;
  const scoreBefore = engine.score;
  engine.orb.x = portal.x;
  engine.orb.y = portal.y;
  await new Promise((r) => setTimeout(r, 150));
  const rejected = engine.score === scoreBefore && portal.rejectFlash > 0;
  // Now lower the demand below the orb's mass and retry.
  engine.orb.x = 195;
  engine.orb.y = 700;
  await new Promise((r) => setTimeout(r, 300));
  portal.color = engine.orb.color;
  portal.minMass = 1;
  engine.orb.x = portal.x;
  engine.orb.y = portal.y;
  await new Promise((r) => setTimeout(r, 400));
  return { rejected, delivered: engine.score > scoreBefore };
});
check('min-mass: too small rejected, big enough delivers', minMass.rejected && minMass.delivered, JSON.stringify(minMass));

// --- Pure request: majority is not enough, all 3 pips must match ---
const pure = await page.evaluate(async () => {
  const { engine, CONFIG } = window.__fizzion;
  const portal = engine.portal;
  engine.orb.x = 195;
  engine.orb.y = 700;
  await new Promise((r) => setTimeout(r, 300)); // clear portal contact
  const c = '#00ff88';
  portal.requestType = 'pure';
  portal.color = c;
  portal.minMass = 0;
  portal.timeLeft = 30;
  portal.duration = 30;
  // Right majority but mixed pips: pure must reject.
  engine.orb.pips = [c, '#ff2975', c];
  engine.orb.color = c;
  engine.orb.mass = 6;
  const scoreBefore = engine.score;
  engine.orb.x = portal.x;
  engine.orb.y = portal.y;
  await new Promise((r) => setTimeout(r, 150));
  const rejected = engine.score === scoreBefore && portal.rejectFlash > 0;
  // All 3 pips matching: accepted at triple score.
  engine.orb.x = 195;
  engine.orb.y = 700;
  await new Promise((r) => setTimeout(r, 300));
  portal.requestType = 'pure';
  portal.color = c;
  portal.minMass = 0;
  portal.timeLeft = 30;
  portal.duration = 30;
  engine.orb.pips = [c, c, c];
  engine.orb.color = c;
  engine.orb.mass = 6;
  const stabilityBefore = Math.min(engine.stability, 0.5); // headroom for restore check
  engine.stability = stabilityBefore;
  engine.orb.x = portal.x;
  engine.orb.y = portal.y;
  await new Promise((r) => setTimeout(r, 400));
  return {
    rejected,
    gained: engine.score - scoreBefore,
    expected: Math.round(6 * CONFIG.scorePerMass * engine.chain * CONFIG.pureScoreMult),
    restored: engine.stability - stabilityBefore,
    minRestore: CONFIG.stabilityRestoreDelivery * CONFIG.pureRestoreMult,
  };
});
check('pure request rejects mixed pips', pure.rejected, JSON.stringify(pure));
check(
  'pure delivery scores x3 and restores x2',
  pure.gained === pure.expected && pure.gained > 0 && pure.restored >= pure.minRestore - 0.001,
  JSON.stringify(pure),
);

// --- Rush request: doubled score ---
const rush = await page.evaluate(async () => {
  const { engine, CONFIG } = window.__fizzion;
  const portal = engine.portal;
  engine.orb.x = 195;
  engine.orb.y = 700;
  await new Promise((r) => setTimeout(r, 300));
  const c = '#00cfff';
  portal.requestType = 'rush';
  portal.color = c;
  portal.minMass = 0;
  portal.timeLeft = 30;
  portal.duration = 30;
  engine.orb.pips = [c];
  engine.orb.color = c;
  engine.orb.mass = 4;
  const scoreBefore = engine.score;
  engine.orb.x = portal.x;
  engine.orb.y = portal.y;
  await new Promise((r) => setTimeout(r, 400));
  return {
    gained: engine.score - scoreBefore,
    expected: Math.round(4 * CONFIG.scorePerMass * engine.chain * CONFIG.rushScoreMult),
  };
});
check('rush delivery scores x2', rush.gained === rush.expected && rush.gained > 0, JSON.stringify(rush));

// --- Portal relocation: gated, delivery-driven, never on expiry ---
const relocation = await page.evaluate(async () => {
  const { engine, CONFIG } = window.__fizzion;
  CONFIG.relocateMinDistFrac = 0.25; // generous satisfiable region on a phone screen
  const portal = engine.portal;
  const c = '#ffd500';

  const forceDeliver = async () => {
    engine.orb.x = 60;
    engine.orb.y = 760;
    await new Promise((r) => setTimeout(r, 300)); // clear portal contact
    portal.requestType = 'normal';
    portal.color = c;
    portal.minMass = 0;
    portal.timeLeft = 30;
    portal.duration = 30;
    engine.orb.pips = [c];
    engine.orb.color = c;
    engine.orb.mass = 2;
    engine.orb.x = portal.x;
    engine.orb.y = portal.y;
    await new Promise((r) => setTimeout(r, 900)); // hit-stop + celebration + reroll midpoint
  };

  // Gates closed (young run): a delivery must NOT move the portal.
  engine.runTime = 5;
  engine.deliveries = 0;
  engine.deliveriesSinceRelocate = 0;
  const before1 = { x: portal.x, y: portal.y };
  await forceDeliver();
  const gatedMove = Math.hypot(portal.x - before1.x, portal.y - before1.y);

  // Gates open: run old enough, enough deliveries, cadence reached.
  engine.runTime = CONFIG.relocateMinTime + 1;
  engine.deliveries = CONFIG.relocateMinDeliveries;
  engine.deliveriesSinceRelocate = 10;
  const before2 = { x: portal.x, y: portal.y };
  await forceDeliver();
  const relocatedMove = Math.hypot(portal.x - before2.x, portal.y - before2.y);
  const counterReset = engine.deliveriesSinceRelocate <= 1;

  // Expiry reroll must never relocate.
  const before3 = { x: portal.x, y: portal.y };
  engine.stability = 1;
  portal.rerollLeft = 0;
  portal.lockLeft = 0;
  portal.timeLeft = 0.01;
  await new Promise((r) => setTimeout(r, 700));
  const expiryMove = Math.hypot(portal.x - before3.x, portal.y - before3.y);

  const minDist = Math.hypot(390, 844) * CONFIG.relocateMinDistFrac;
  return { gatedMove, relocatedMove, expiryMove, minDist, counterReset };
});
check(
  'relocation gates: no move before minTime/minDeliveries',
  relocation.gatedMove < 1,
  JSON.stringify(relocation),
);
check(
  'relocation fires past the gates and jumps far enough',
  relocation.relocatedMove >= relocation.minDist && relocation.counterReset,
  `moved=${relocation.relocatedMove.toFixed(0)} min=${relocation.minDist.toFixed(0)}`,
);
check('expiry reroll never relocates', relocation.expiryMove < 1, `moved=${relocation.expiryMove.toFixed(1)}`);

// --- Pip thief: steals the newest pip, never stability or the chain ---
const steal = await page.evaluate(async () => {
  const { engine } = window.__fizzion;
  engine.portal.timeLeft = 30; // no expiry noise during the test
  engine.portal.duration = 30;
  engine.orb.x = 195;
  engine.orb.y = 600;
  engine.orb.vx = 0;
  engine.orb.vy = 0;
  engine.orb.pips = ['#00ff88', '#00ff88', '#ff2975'];
  engine.orb.color = '#00ff88';
  engine.orb.mass = 5;
  engine.chain = 2;
  engine.chainTimeLeft = 30;
  const stabilityBefore = engine.stability;
  engine.hazards.push({
    x: engine.orb.x + 4, y: engine.orb.y, vx: 0, vy: 0,
    state: 'hunting', stateT: 0, life: 30, phase: 0,
  });
  await new Promise((r) => setTimeout(r, 150));
  return {
    pips: [...engine.orb.pips],
    color: engine.orb.color,
    mass: engine.orb.mass,
    hazardState: engine.hazards[0].state,
    stolenFlash: engine.orb.stolenFlash,
    kicked: Math.hypot(engine.orb.vx, engine.orb.vy) > 80,
    chain: engine.chain,
    stabilityDelta: Math.abs(engine.stability - stabilityBefore),
  };
});
check(
  'hazard steals the newest pip (mass -1, majority recomputed, thief flees)',
  JSON.stringify(steal.pips) === JSON.stringify(['#00ff88', '#00ff88']) &&
    steal.color === '#00ff88' &&
    steal.mass === 4 &&
    steal.hazardState === 'fleeing' &&
    steal.kicked,
  JSON.stringify(steal),
);
check('steal sets orb.stolenFlash (red flicker feedback)', steal.stolenFlash > 0, `flash=${steal.stolenFlash.toFixed(2)}`);
check(
  'steal never touches stability or the chain',
  steal.chain === 2 && steal.stabilityDelta < 0.001,
  JSON.stringify(steal),
);

// --- Pipless contact is just a soft bounce ---
const bounce = await page.evaluate(async () => {
  const { engine } = window.__fizzion;
  engine.hazards.length = 0;
  engine.orb.x = 195;
  engine.orb.y = 600;
  engine.orb.vx = 0;
  engine.orb.vy = 0;
  engine.orb.pips = [];
  engine.orb.mass = 1;
  engine.orb.stolenFlash = 0;
  engine.hazards.push({
    x: engine.orb.x + 4, y: engine.orb.y, vx: 0, vy: 0,
    state: 'hunting', stateT: 0, life: 30, phase: 0,
  });
  await new Promise((r) => setTimeout(r, 150));
  return {
    pips: engine.orb.pips.length,
    mass: engine.orb.mass,
    hazardState: engine.hazards[0].state,
    stolenFlash: engine.orb.stolenFlash,
    kicked: Math.hypot(engine.orb.vx, engine.orb.vy) > 40,
  };
});
check(
  'pipless contact: no steal, no flash, soft bounce, thief still flees',
  bounce.pips === 0 && bounce.mass === 1 && bounce.hazardState === 'fleeing' &&
    bounce.stolenFlash === 0 && bounce.kicked,
  JSON.stringify(bounce),
);

// --- Hazard raids: difficulty-gated spawns, limited lifetime, cooldown between ---
const raids = await page.evaluate(async () => {
  const { engine, CONFIG } = window.__fizzion;
  engine.hazards.length = 0;
  CONFIG.hazardMaxCount = 2; // re-enable for this test only
  engine.hazardCooldown = 0;
  engine.runTime = 1; // difficulty ~0: no raid
  await new Promise((r) => setTimeout(r, 150));
  const early = engine.hazards.length;

  engine.runTime = CONFIG.rampDuration * (CONFIG.hazardRampStart + 0.05); // just past the gate
  await new Promise((r) => setTimeout(r, 150));
  const mid = engine.hazards.length;
  const cooldownArmed = engine.hazardCooldown > 5;

  // Run the raid's clock out: it must flicker out and clean up on its own.
  for (const hz of engine.hazards) {
    hz.stateT = 0; // end the spawn telegraph now
    hz.life = 0.05;
  }
  await new Promise((r) => setTimeout(r, 300));
  const dissipating =
    engine.hazards.length > 0 && engine.hazards.every((hz) => hz.state === 'despawning');
  await new Promise((r) => setTimeout(r, CONFIG.hazardDespawnTime * 1000 + 400));
  const cleared = engine.hazards.length;
  const stillWaiting = engine.hazardCooldown > 5; // next raid held by the cooldown

  // Cooldown elapses at full difficulty: raid of two.
  engine.hazardCooldown = 0.05;
  engine.runTime = 1e6; // pinned at 1
  await new Promise((r) => setTimeout(r, 250));
  const late = engine.hazards.length;

  CONFIG.hazardMaxCount = 0; // back off for the rest of the suite
  engine.hazards.length = 0;
  engine.runTime = 60;
  return { early, mid, cooldownArmed, dissipating, cleared, stillWaiting, late };
});
check(
  'raid gate: none early, one thief mid-ramp, two at full difficulty',
  raids.early === 0 && raids.mid === 1 && raids.late === 2,
  JSON.stringify(raids),
);
check(
  'raid expires: thief flickers out, removes itself, next raid waits on cooldown',
  raids.dissipating && raids.cleared === 0 && raids.cooldownArmed && raids.stillWaiting,
  JSON.stringify(raids),
);

// --- Overload ---
const overload = await page.evaluate(async () => {
  const { engine, CONFIG, useGameStore } = window.__fizzion;
  engine.chain = 3; // pretend an ongoing chain
  engine.orb.mass = CONFIG.overloadMass - 1;
  engine.orb.pips = ['#00ff88', '#00ff88', '#ffd500'];
  engine.orb.color = '#00ff88';
  const nonceBefore = useGameStore.getState().chainBreakNonce;
  const stabilityBefore = engine.stability;
  const heatBefore = engine.comboHeat;
  engine.particles.push({
    x: engine.orb.x, y: engine.orb.y, vx: 0, vy: 0, color: '#00ff88', phase: 0,
    state: 'attract', ax: engine.orb.x, ay: engine.orb.y, attractT: 1,
  });
  await new Promise((r) => setTimeout(r, 150));
  const scattered = engine.particles.filter((p) => p.expireLife !== undefined).length;
  const graced = engine.particles.filter((p) => p.collectDelay !== undefined && p.collectDelay > 0).length;
  // Park the respawned orb away from the scatter so it doesn't hoover it up.
  engine.orb.x = 60;
  engine.orb.y = 760;
  engine.orb.vx = 0;
  engine.orb.vy = 0;
  // Wait past the collect-delay window: no chain-reaction second overload.
  await new Promise((r) => setTimeout(r, 600));
  const later = {
    mass: engine.orb.mass,
    overloads: engine.overloads,
    collectible: engine.particles.some(
      (p) => p.expireLife !== undefined && !(p.collectDelay > 0),
    ),
  };
  return {
    mass: engine.orb.mass,
    chain: engine.chain,
    scattered,
    graced,
    overloads: engine.overloads,
    chainBroke: useGameStore.getState().chainBreakNonce === nonceBefore + 1,
    later,
    stabilityDrop: stabilityBefore - engine.stability,
    expectedDrop: CONFIG.stabilityDrainOverload,
    heatHalved: heatBefore === 0 || engine.comboHeat < heatBefore * 0.6,
  };
});
check(
  'overload: respawn at mass 1, chain broken, ~mass particles scattered with grace',
  overload.chain === 0 && overload.scattered >= 18 && overload.graced >= 18 && overload.chainBroke,
  JSON.stringify(overload),
);
check(
  'overload: no endless chain reaction, particles become collectible',
  overload.later.overloads === 1 && overload.later.mass < 5 && overload.later.collectible,
  JSON.stringify(overload.later),
);
check(
  'overload drains stability and halves combo heat',
  Math.abs(overload.stabilityDrop - overload.expectedDrop) < 0.01 && overload.heatHalved,
  `drop=${overload.stabilityDrop.toFixed(2)} expected=${overload.expectedDrop}`,
);

// --- Stabilize command ---
const stabilize = await page.evaluate(() => {
  const { engine, CONFIG } = window.__fizzion;
  engine.orb.mass = CONFIG.overloadMass - 1;
  const before = engine.instability;
  engine.applyStabilize();
  return { before, after: engine.instability };
});
check(
  'stabilize resets instability to ~50%',
  stabilize.before > 0.9 && Math.abs(stabilize.after - 0.5) < 0.05,
  JSON.stringify(stabilize),
);

// --- Color lock freezes portal timer ---
const lock = await page.evaluate(async () => {
  const { engine } = window.__fizzion;
  engine.activateColorLock();
  const t0 = engine.portal.timeLeft;
  await new Promise((r) => setTimeout(r, 500));
  return { t0, t1: engine.portal.timeLeft, lockLeft: engine.portal.lockLeft };
});
check(
  'color lock freezes request timer',
  Math.abs(lock.t1 - lock.t0) < 0.01 && lock.lockLeft > 4,
  JSON.stringify(lock),
);

// --- Request variety rolls at high difficulty ---
const variety = await page.evaluate(async () => {
  const { engine, CONFIG } = window.__fizzion;
  engine.portal.lockLeft = 0;
  engine.portal.rerollLeft = 0;
  engine.runTime = 1e6; // difficulty pinned at 1
  const seen = { normal: 0, rush: 0, pure: 0 };
  let rushDuration = -1;
  for (let i = 0; i < 40; i++) {
    engine.stability = 1; // keep expiry drain from ending the run
    engine.portal.rerollLeft = 0;
    engine.portal.timeLeft = 0.01;
    await new Promise((r) => setTimeout(r, 80));
    seen[engine.portal.requestType]++;
    if (engine.portal.requestType === 'rush') rushDuration = engine.portal.duration;
  }
  return { seen, rushDuration, expectedRush: CONFIG.portalTimeMin * CONFIG.rushTimeFactor };
});
check(
  'high difficulty rolls normal, rush and pure requests',
  variety.seen.rush > 0 && variety.seen.pure > 0 && variety.seen.normal > 0,
  JSON.stringify(variety.seen),
);
check(
  'rush request duration is halved',
  Math.abs(variety.rushDuration - variety.expectedRush) < 0.01,
  `${variety.rushDuration} vs ${variety.expectedRush}`,
);

// --- Stability zero offers Second Wind (revive) first ---
const collapse = await page.evaluate(async () => {
  const { engine, useGameStore } = window.__fizzion;
  engine.portal.lockLeft = 0;
  engine.portal.rerollLeft = 0; // timer is frozen during the reroll anim
  engine.stability = 0.01;
  engine.portal.timeLeft = 0.01; // force an expiry to drain the rest
  await new Promise((r) => setTimeout(r, 600));
  const s = useGameStore.getState();
  return {
    phase: s.phase,
    stability: engine.stability,
    hasPending: !!s.pendingStats,
  };
});
check(
  'stability zero offers Second Wind (revive phase, stats pending)',
  collapse.phase === 'revive' && collapse.stability === 0 && collapse.hasPending,
  JSON.stringify(collapse),
);

// --- Revive resumes the run with restored stability, keeping score ---
const revive = await page.evaluate(async () => {
  const { engine, useGameStore, CONFIG } = window.__fizzion;
  const scoreBefore = engine.score;
  const runTimeBefore = engine.runTime;
  engine.revive();
  useGameStore.getState().acceptRevive();
  await new Promise((r) => setTimeout(r, 200));
  return {
    phase: useGameStore.getState().phase,
    stability: engine.stability,
    expected: CONFIG.reviveStability,
    scoreKept: engine.score === scoreBefore,
    runTimeKept: engine.runTime >= runTimeBefore,
  };
});
check(
  'revive restores stability and keeps score/runTime',
  revive.phase === 'playing' &&
    Math.abs(revive.stability - revive.expected) < 0.05 &&
    revive.scoreKept &&
    revive.runTimeKept,
  JSON.stringify(revive),
);

// --- Second death: revive already used, run ends for real ---
const secondDeath = await page.evaluate(async () => {
  const { engine, useGameStore } = window.__fizzion;
  engine.portal.lockLeft = 0;
  engine.portal.rerollLeft = 0;
  engine.stability = 0.01;
  engine.portal.timeLeft = 0.01;
  await new Promise((r) => setTimeout(r, 600));
  const s = useGameStore.getState();
  return { phase: s.phase, duration: s.lastRound?.duration ?? -1 };
});
check(
  'second collapse skips the offer and ends the run',
  secondDeath.phase === 'results' && secondDeath.duration > 0,
  JSON.stringify(secondDeath),
);

// --- IAP: Sparks pack + Remove Ads ---
const iap = await page.evaluate(() => {
  const { useGameStore } = window.__fizzion;
  useGameStore.setState({ sparks: 0 });
  useGameStore.getState().completePurchase('sparks_small');
  const sparksAfterPack = useGameStore.getState().sparks;
  const adsBefore = useGameStore.getState().adsRemoved;
  useGameStore.getState().completePurchase('remove_ads');
  const adsAfter = useGameStore.getState().adsRemoved;
  useGameStore.setState({ adsRemoved: false }); // reset for later checks
  return { sparksAfterPack, adsBefore, adsAfter };
});
check(
  'IAP: sparks pack grants 500, remove_ads sets the flag',
  iap.sparksAfterPack === 500 && !iap.adsBefore && iap.adsAfter,
  JSON.stringify(iap),
);

// --- Upgrades: purchase, effect application, persistence, migration ---
const shop = await page.evaluate(() => {
  const { useGameStore, upgradeEffects } = window.__fizzion;
  useGameStore.setState({ sparks: 1000 });
  const multBefore = upgradeEffects.expireDrainMult;
  useGameStore.getState().buyUpgrade('reinforced_portal');
  const s = useGameStore.getState();
  // Broke: buying with 0 Sparks must be a no-op.
  useGameStore.setState({ sparks: 0 });
  useGameStore.getState().buyUpgrade('magnet_core');
  const s2 = useGameStore.getState();
  useGameStore.setState({ sparks: s.sparks }); // restore for the save
  return {
    sparks: s.sparks,
    level: s.upgrades.reinforced_portal,
    multBefore,
    multAfter: upgradeEffects.expireDrainMult,
    brokeLevel: s2.upgrades.magnet_core ?? 0,
    brokeRange: upgradeEffects.collectRangeMult,
  };
});
check(
  'buyUpgrade deducts Sparks and applies effect',
  shop.sparks === 800 &&
    shop.level === 1 &&
    shop.multBefore === 1 &&
    Math.abs(shop.multAfter - 0.88) < 1e-9,
  JSON.stringify(shop),
);
check(
  'buyUpgrade with insufficient Sparks is a no-op',
  shop.brokeLevel === 0 && shop.brokeRange === 1,
  JSON.stringify(shop),
);

// Purchase must survive a reload (v2 save schema).
await page.waitForTimeout(1200); // debounced save
await page.reload();
await page.waitForFunction(() => window.__fizzion, null, { timeout: 10000 });
const persisted = await page.evaluate(() => {
  const { useGameStore, upgradeEffects } = window.__fizzion;
  const s = useGameStore.getState();
  const raw = JSON.parse(localStorage.getItem('fizzion_save'));
  return {
    version: raw.version,
    level: s.upgrades.reinforced_portal,
    mult: upgradeEffects.expireDrainMult,
    sparks: s.sparks,
  };
});
check(
  'purchase survives reload with v3 save',
  persisted.version === 3 &&
    persisted.level === 1 &&
    Math.abs(persisted.mult - 0.88) < 1e-9 &&
    persisted.sparks === 800,
  JSON.stringify(persisted),
);

// A v2 save (upgrades but no adsRemoved) must migrate cleanly.
await page.evaluate(() => {
  localStorage.setItem(
    'fizzion_save',
    JSON.stringify({
      version: 2,
      data: {
        sparks: 300, bestScore: 10, bestChain: 3, roundsPlayed: 4, muted: false,
        upgrades: { magnet_core: 2 },
      },
    }),
  );
});
await page.reload();
await page.waitForFunction(() => window.__fizzion, null, { timeout: 10000 });
const migratedV2 = await page.evaluate(() => {
  const { useGameStore, upgradeEffects } = window.__fizzion;
  const s = useGameStore.getState();
  return {
    sparks: s.sparks,
    magnet: s.upgrades.magnet_core,
    adsRemoved: s.adsRemoved,
    range: upgradeEffects.collectRangeMult,
  };
});
check(
  'v2 save migrates (upgrades kept, adsRemoved defaults false)',
  migratedV2.sparks === 300 &&
    migratedV2.magnet === 2 &&
    migratedV2.adsRemoved === false &&
    Math.abs(migratedV2.range - 1.24) < 1e-9,
  JSON.stringify(migratedV2),
);

// A v1 save (no upgrades field) must migrate cleanly.
await page.evaluate(() => {
  localStorage.setItem(
    'fizzion_save',
    JSON.stringify({
      version: 1,
      data: { sparks: 123, bestScore: 55, bestChain: 4, roundsPlayed: 7, muted: false },
    }),
  );
});
await page.reload();
await page.waitForFunction(() => window.__fizzion, null, { timeout: 10000 });
const migrated = await page.evaluate(() => {
  const { useGameStore, upgradeEffects } = window.__fizzion;
  const s = useGameStore.getState();
  return {
    sparks: s.sparks,
    bestScore: s.bestScore,
    upgrades: s.upgrades,
    mult: upgradeEffects.expireDrainMult,
  };
});
check(
  'v1 save migrates (data kept, empty upgrades)',
  migrated.sparks === 123 &&
    migrated.bestScore === 55 &&
    Object.keys(migrated.upgrades).length === 0 &&
    migrated.mult === 1,
  JSON.stringify(migrated),
);

// --- FTUE completion persists ---
const ftue = await page.evaluate(() => {
  const { useGameStore } = window.__fizzion;
  const before = useGameStore.getState().ftueDone;
  useGameStore.getState().completeFtue();
  return { before, after: useGameStore.getState().ftueDone };
});
check('completeFtue sets the flag', !ftue.before && ftue.after, JSON.stringify(ftue));

await page.waitForTimeout(1200); // debounced save
await page.reload();
await page.waitForFunction(() => window.__fizzion, null, { timeout: 10000 });
const ftuePersist = await page.evaluate(() => window.__fizzion.useGameStore.getState().ftueDone);
check('ftueDone persists across reload', ftuePersist === true, `ftueDone=${ftuePersist}`);

// --- Request coach: teaches "2x" (rush) once, flag persists ---
// State here: ftueDone=true, roundsPlayed=7 -> the coach never yields.
const requestToast = await page.evaluate(async () => {
  const { engine, useGameStore } = window.__fizzion;
  useGameStore.getState().beginRound();
  engine.startRound();
  await new Promise((r) => setTimeout(r, 300));
  engine.portal.requestType = 'rush';
  await new Promise((r) => setTimeout(r, 350)); // store sync + coach effect
  const s = useGameStore.getState();
  return { requestType: s.requestType, taughtRush: s.requestsTaught.rush === true };
});
check(
  'snapshot exposes requestType and coach marks rush taught',
  requestToast.requestType === 'rush' && requestToast.taughtRush,
  JSON.stringify(requestToast),
);
check(
  'RUSH toast visible on first sighting',
  await page.getByText('RUSH — half the time').isVisible(),
);

// One-shot: after it hides, a fresh rush sighting shows nothing.
await page.waitForTimeout(4800);
await page.evaluate(() => {
  window.__fizzion.engine.portal.requestType = 'normal';
});
await page.waitForTimeout(250);
await page.evaluate(() => {
  window.__fizzion.engine.portal.requestType = 'rush';
});
await page.waitForTimeout(400);
check(
  'rush toast is one-shot',
  !(await page.getByText('RUSH — half the time').isVisible().catch(() => false)),
);

// The taught flag persists, and min-mass teaches independently after reload.
await page.waitForTimeout(1200); // debounced save
await page.reload();
await page.waitForFunction(() => window.__fizzion, null, { timeout: 10000 });
const taughtAfter = await page.evaluate(
  () => window.__fizzion.useGameStore.getState().requestsTaught,
);
check('requestsTaught persists across reload', taughtAfter.rush === true, JSON.stringify(taughtAfter));
await page.evaluate(async () => {
  const { engine, useGameStore } = window.__fizzion;
  useGameStore.getState().beginRound();
  engine.startRound();
  await new Promise((r) => setTimeout(r, 300));
  engine.portal.minMass = 5;
});
await page.waitForTimeout(400);
check(
  'min-mass toast appears on first N+ sighting',
  await page.getByText('This portal wants a bigger orb').isVisible(),
);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
