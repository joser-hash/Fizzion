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
// The FTUE color ramp is tested explicitly at the end; everything before
// assumes the full 4-color game, so mark it complete up front.
await page.evaluate(() => {
  window.__fizzion.useGameStore.setState({ colorRampDone: true });
});
await page.mouse.click(195, 420); // start round
await page.waitForTimeout(300);

// Determinism: kill ambient food so tests fully control what the orb eats,
// block hazard auto-spawns, and push the boost offer out of reach — both
// are tested explicitly further down.
await page.evaluate(() => {
  const { engine, CONFIG } = window.__fizzion;
  CONFIG.maxParticles = 0; // stops the periodic cluster top-up
  CONFIG.hazardMaxCount = 0;
  CONFIG.boostFirstAt = 9999; // also gates the relocation-fused offers
  CONFIG.bonusRampStart = 9; // no bonus portals (tested explicitly at the end)
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
  // The relocation test left the portal at a random spot: park it far from
  // the steal site so a matching orb can't accidentally deliver mid-test.
  engine.portal.x = 340;
  engine.portal.y = 120;
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
  'hazard steals the newest pip (mass kept, majority recomputed, thief flees)',
  JSON.stringify(steal.pips) === JSON.stringify(['#00ff88', '#00ff88']) &&
    steal.color === '#00ff88' &&
    steal.mass === 5 &&
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
const overloadsSignal = await page.evaluate(async () => {
  await new Promise((r) => setTimeout(r, 250)); // 10Hz sync tick
  return window.__fizzion.useGameStore.getState().overloads;
});
check('HUD snapshot exposes overloads', overloadsSignal >= 1, `overloads=${overloadsSignal}`);

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

// --- Stability zero offers Second Chance (revive) first ---
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
  'stability zero offers Second Chance (revive phase, stats pending)',
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

// Purchase must survive a reload (versioned save schema).
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
  'purchase survives reload with v5 save',
  persisted.version === 5 &&
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

// --- FTUE color ramp: colors unlock with deliveries, grace before the 1st ---
const ramp = await page.evaluate(async () => {
  const { engine, CONFIG, useGameStore, GAME_COLORS } = window.__fizzion;
  useGameStore.setState({ colorRampDone: false });
  CONFIG.maxParticles = 40; // restore ambient food to inspect spawn colors
  useGameStore.getState().beginRound();
  engine.startRound({ colorRamp: true });
  await new Promise((r) => setTimeout(r, 200));

  const pair = GAME_COLORS.slice(0, 2);
  const start = {
    activeCount: engine.activeColors.length,
    portalInPair: pair.includes(engine.portal.color),
    allParticlesInPair: engine.particles.every((p) => pair.includes(p.color)),
    particleCount: engine.particles.length,
  };

  // Learner freeze: before ~3 catches the request timer is pinned at full,
  // so a forced low timeLeft snaps back instead of expiring.
  engine.portal.timeLeft = 0.01;
  await new Promise((r) => setTimeout(r, 150));
  const freeze = {
    timeLeft: engine.portal.timeLeft,
    duration: engine.portal.duration,
    stability: engine.stability,
  };

  // Expiry before the first delivery (freeze lifted via mass): reroll
  // (within the pair), but no stability drain.
  engine.orb.mass = 5;
  engine.portal.timeLeft = 0.01;
  await new Promise((r) => setTimeout(r, 150));
  const grace = {
    stability: engine.stability,
    nextColorInPair: pair.includes(engine.portal.nextColor),
  };
  engine.orb.mass = 1; // back to a fresh-orb state for the delivery below

  // First delivery: still 2 colors (3rd unlocks at 2 deliveries).
  await new Promise((r) => setTimeout(r, 600)); // reroll anim + contact reset
  engine.orb.x = 195;
  engine.orb.y = 700;
  await new Promise((r) => setTimeout(r, 200));
  engine.orb.pips = [pair[0]];
  engine.orb.color = pair[0];
  engine.portal.color = pair[0];
  engine.portal.minMass = 0;
  engine.orb.x = engine.portal.x;
  engine.orb.y = engine.portal.y;
  await new Promise((r) => setTimeout(r, 400)); // hit-stop + celebration
  const afterFirst = engine.activeColors.length;

  // Later thresholds: jump the delivery counter directly.
  engine.deliveries = 2;
  const afterSecond = engine.activeColors.length;
  engine.deliveries = 4;
  const afterFourth = engine.activeColors.length;
  await new Promise((r) => setTimeout(r, 300)); // store sync marks completion
  const rampDone = useGameStore.getState().colorRampDone;

  return { start, freeze, grace, afterFirst, afterSecond, afterFourth, rampDone };
});
check(
  'learner freeze pins the first request timer until a few catches',
  ramp.freeze.timeLeft > ramp.freeze.duration - 1 && ramp.freeze.stability === 1,
  JSON.stringify(ramp.freeze),
);
check(
  'ramp start: 2 active colors, portal + all particles within the pair',
  ramp.start.activeCount === 2 &&
    ramp.start.portalInPair &&
    ramp.start.allParticlesInPair &&
    ramp.start.particleCount > 0,
  JSON.stringify(ramp.start),
);
check(
  'pre-first-delivery expiry: no stability drain, reroll stays in the pair',
  ramp.grace.stability === 1 && ramp.grace.nextColorInPair,
  JSON.stringify(ramp.grace),
);
check(
  'colors unlock at 2/4 deliveries (2 -> 3 -> 4 active)',
  ramp.afterFirst === 2 && ramp.afterSecond === 3 && ramp.afterFourth === 4,
  `after1=${ramp.afterFirst} after2=${ramp.afterSecond} after4=${ramp.afterFourth}`,
);
check('colorRampDone set once all colors unlocked', ramp.rampDone === true);

// Completion persists: after reload, runs start with the full palette.
await page.waitForTimeout(1200); // debounced save
await page.reload();
await page.waitForFunction(() => window.__fizzion, null, { timeout: 10000 });
const rampPersist = await page.evaluate(
  () => window.__fizzion.useGameStore.getState().colorRampDone,
);
check('colorRampDone persists across reload', rampPersist === true, `done=${rampPersist}`);

// --- Unlock seeds the new color; portal only requests collectible colors ---
const seed = await page.evaluate(async () => {
  const { engine, useGameStore, GAME_COLORS } = window.__fizzion;
  useGameStore.setState({ colorRampDone: false });
  useGameStore.getState().beginRound();
  engine.startRound({ colorRamp: true });
  await new Promise((r) => setTimeout(r, 200));

  // One delivery away from the 3rd-color unlock; deliver for real so the
  // unlock path (recolor + reroll) runs.
  engine.deliveries = 1;
  engine.orb.x = 195;
  engine.orb.y = 700;
  await new Promise((r) => setTimeout(r, 300)); // contact reset
  const c = GAME_COLORS[0];
  engine.orb.pips = [c];
  engine.orb.color = c;
  engine.portal.color = c;
  engine.portal.minMass = 0;
  engine.orb.x = engine.portal.x;
  engine.orb.y = engine.portal.y;
  await new Promise((r) => setTimeout(r, 400)); // hit-stop + celebration

  const third = GAME_COLORS[2];
  const countOf = (color) =>
    engine.particles.filter(
      (p) => p.color === color && p.state === 'idle' && p.expireLife === undefined,
    ).length;
  return {
    deliveries: engine.deliveries,
    thirdOnField: countOf(third),
    requestedOnField: countOf(engine.portal.nextColor),
  };
});
check(
  'color unlock recolors drops so the new color is on the field',
  seed.deliveries === 2 && seed.thirdOnField >= 3,
  JSON.stringify(seed),
);
check(
  'portal request color has collectible food on the field',
  seed.requestedOnField >= 3,
  JSON.stringify(seed),
);

// --- In-run boosts: offer fires at the 3rd delivery and freezes the run ---
const boostOffer = await page.evaluate(async () => {
  const { engine, CONFIG, useGameStore } = window.__fizzion;
  useGameStore.setState({ colorRampDone: true });
  CONFIG.boostFirstAt = 3;
  CONFIG.boostOfferDelayMs = 50;
  CONFIG.maxParticles = 0;
  CONFIG.hazardMaxCount = 0;
  useGameStore.getState().beginRound();
  engine.startRound();
  engine.particles.length = 0;
  await new Promise((r) => setTimeout(r, 300));

  const c = '#00ff88';
  const forceDeliver = async () => {
    engine.orb.x = 60;
    engine.orb.y = 760;
    await new Promise((r) => setTimeout(r, 300)); // clear portal contact
    const p = engine.portal;
    p.requestType = 'normal';
    p.color = c;
    p.minMass = 0;
    p.timeLeft = 30;
    p.duration = 30;
    p.rerollLeft = 0; // skip the reroll anim's contact lockout
    engine.orb.pips = [c];
    engine.orb.color = c;
    engine.orb.mass = 2;
    engine.orb.x = p.x;
    engine.orb.y = p.y;
    await new Promise((r) => setTimeout(r, 700)); // hit-stop + celebration
  };
  await forceDeliver();
  await forceDeliver();
  const offerAfterTwo = useGameStore.getState().boostOffer;
  await forceDeliver();
  await new Promise((r) => setTimeout(r, 400)); // offer delay + callback
  const s = useGameStore.getState();
  return {
    deliveries: engine.deliveries,
    offerAfterTwo,
    offer: s.boostOffer,
    unique: s.boostOffer ? new Set(s.boostOffer).size : 0,
    paused: engine.paused,
  };
});
check(
  'boost offer fires at the 3rd delivery (not before), engine paused',
  boostOffer.offerAfterTwo === null &&
    Array.isArray(boostOffer.offer) &&
    boostOffer.offer.length === 3 &&
    boostOffer.unique === 3 &&
    boostOffer.paused,
  JSON.stringify(boostOffer),
);
check('boost pick modal visible', await page.getByText('POWER SURGE').isVisible());

// --- Picking a card applies the boost and resumes the run ---
const boostPick = await page.evaluate(async () => {
  const { engine, useGameStore } = window.__fizzion;
  const id = useGameStore.getState().boostOffer[0];
  useGameStore.getState().chooseBoost(id);
  await new Promise((r) => setTimeout(r, 100));
  const s = useGameStore.getState();
  return {
    id,
    paused: engine.paused,
    offerCleared: s.boostOffer === null,
    storeOwned: [...s.ownedBoosts],
    engineOwned: [...engine.boosts],
  };
});
check(
  'chooseBoost applies, records ownership, and resumes the engine',
  !boostPick.paused &&
    boostPick.offerCleared &&
    boostPick.storeOwned.length === 1 &&
    boostPick.storeOwned[0] === boostPick.id &&
    boostPick.engineOwned[0] === boostPick.id,
  JSON.stringify(boostPick),
);

// --- Uniqueness: owned boosts never re-offered; pool drains to empty ---
const boostRolls = await page.evaluate(() => {
  const { engine, boosts } = window.__fizzion;
  const all = boosts.BOOST_CATALOG.map((b) => b.id);
  const rolled = [];
  for (let i = 0; i < 30; i++) rolled.push(...boosts.rollBoostOptions(engine.boosts));
  const reroll = engine.rerollBoosts();
  return {
    neverOwned: rolled.every((id) => !engine.boosts.includes(id)),
    lastOne: boosts.rollBoostOptions(all.slice(0, 8)),
    lastId: all[8],
    empty: boosts.rollBoostOptions(all),
    rerollLen: reroll.length,
    rerollExcludesOwned: reroll.every((id) => !engine.boosts.includes(id)),
  };
});
check(
  'rolls never include owned boosts; short pool offered as-is; dry pool empty',
  boostRolls.neverOwned &&
    boostRolls.lastOne.length === 1 &&
    boostRolls.lastOne[0] === boostRolls.lastId &&
    boostRolls.empty.length === 0,
  JSON.stringify(boostRolls),
);
check(
  'reroll excludes owned and offers a fresh 3',
  boostRolls.rerollLen === 3 && boostRolls.rerollExcludesOwned,
  JSON.stringify(boostRolls),
);

// No more surprise offers while the effect tests deliver below.
await page.evaluate(() => {
  window.__fizzion.CONFIG.boostFirstAt = 9999;
});

// --- Long Fuse: chain window stretched by +4s on delivery ---
const longFuse = await page.evaluate(async () => {
  const { engine, CONFIG, boosts } = window.__fizzion;
  boosts.resetRunMods(); // isolate from whatever card the pick test chose
  boosts.applyBoost('long_fuse');
  const c = '#00ff88';
  // Park the portal away from the orb and clear the contact latch so the
  // forced delivery below can't be swallowed (same guard as the steal and
  // Prospector probes).
  engine.portal.x = 340;
  engine.portal.y = 120;
  engine.orb.x = 60;
  engine.orb.y = 760;
  await new Promise((r) => setTimeout(r, 300));
  const p = engine.portal;
  p.contact = false;
  p.requestType = 'normal';
  p.color = c;
  p.minMass = 0;
  p.timeLeft = 30;
  p.duration = 30;
  p.rerollLeft = 0;
  engine.orb.pips = [c];
  engine.orb.color = c;
  engine.orb.mass = 2;
  engine.orb.x = p.x;
  engine.orb.y = p.y;
  await new Promise((r) => setTimeout(r, 400));
  return { left: engine.chainTimeLeft, window: CONFIG.chainWindow };
});
check(
  'Long Fuse: chain window exceeds the base after a delivery',
  longFuse.left > longFuse.window + 2,
  `left=${longFuse.left.toFixed(1)} base=${longFuse.window}`,
);

// --- Prism: a 4th pip is carried and counts for pure eligibility ---
const prism = await page.evaluate(async () => {
  const { engine, boosts } = window.__fizzion;
  boosts.resetRunMods();
  boosts.applyBoost('prism');
  const c = '#00cfff';
  const orb = engine.orb;
  orb.x = 195;
  orb.y = 600;
  orb.pips = [];
  const eat = (color) => {
    engine.particles.push({
      x: orb.x, y: orb.y, vx: 0, vy: 0, color, phase: 0,
      state: 'attract', ax: orb.x, ay: orb.y, attractT: 1,
    });
    return new Promise((r) => setTimeout(r, 60));
  };
  await eat(c);
  await eat(c);
  await eat(c);
  await eat(c);
  const pipCount = engine.orb.pips.length;

  // Pure request satisfied by 4 matching pips.
  engine.orb.x = 60;
  engine.orb.y = 760;
  await new Promise((r) => setTimeout(r, 300));
  const p = engine.portal;
  p.requestType = 'pure';
  p.color = c;
  p.minMass = 0;
  p.timeLeft = 30;
  p.duration = 30;
  p.rerollLeft = 0;
  engine.orb.pips = [c, c, c, c];
  engine.orb.color = c;
  engine.orb.mass = 6;
  const scoreBefore = engine.score;
  engine.orb.x = p.x;
  engine.orb.y = p.y;
  await new Promise((r) => setTimeout(r, 400));
  return { pipCount, delivered: engine.score > scoreBefore };
});
check(
  'Prism: 4 pips carried, pure request accepts the 4-stack',
  prism.pipCount === 4 && prism.delivered,
  JSON.stringify(prism),
);

// --- Insurance: the next chain break is forgiven, exactly once ---
const insurance = await page.evaluate(async () => {
  const { engine, boosts } = window.__fizzion;
  boosts.resetRunMods();
  boosts.applyBoost('insurance');
  const c = '#ffd500';
  engine.orb.x = 60;
  engine.orb.y = 760;
  engine.orb.pips = [c];
  engine.orb.color = c;
  engine.chain = 3;
  engine.chainTimeLeft = 30;

  const wasteExpiry = async () => {
    engine.stability = 1;
    engine.portal.rerollLeft = 0;
    engine.portal.lockLeft = 0;
    engine.portal.color = c; // orb matches: expiring is a wasted match
    engine.portal.timeLeft = 0.01;
    await new Promise((r) => setTimeout(r, 300));
  };
  await wasteExpiry();
  const afterShield = { chain: engine.chain, shields: boosts.runMods.chainShields };
  engine.chainTimeLeft = 30; // rearm the window for the second waste
  await wasteExpiry();
  return { afterShield, chainAfterSecond: engine.chain };
});
check(
  'Insurance forgives one wasted expiry, then the next break lands',
  insurance.afterShield.chain === 3 &&
    insurance.afterShield.shields === 0 &&
    insurance.chainAfterSecond === 0,
  JSON.stringify(insurance),
);

// --- Controlled Burn: overload on the portal delivers half mass, no pop ---
const burn = await page.evaluate(async () => {
  const { engine, CONFIG, boosts } = window.__fizzion;
  boosts.resetRunMods();
  boosts.applyBoost('controlled_burn');
  const p = engine.portal;
  const orb = engine.orb;
  const c = '#ff2975';
  await new Promise((r) => setTimeout(r, 600)); // reroll anim settles
  orb.x = p.x;
  orb.y = p.y;
  orb.vx = 0;
  orb.vy = 0;
  p.contact = true; // parked on the portal without triggering a delivery
  p.timeLeft = 30;
  p.duration = 30;
  orb.pips = [c, c, c];
  orb.color = c;
  orb.mass = CONFIG.overloadMass - 1;
  const before = {
    score: engine.score,
    overloads: engine.overloads,
    stability: engine.stability,
  };
  engine.particles.push({
    x: orb.x, y: orb.y, vx: 0, vy: 0, color: c, phase: 0,
    state: 'attract', ax: orb.x, ay: orb.y, attractT: 1,
  });
  await new Promise((r) => setTimeout(r, 500)); // consume -> burn -> celebration
  return {
    gainedScore: engine.score > before.score,
    overloadsUnchanged: engine.overloads === before.overloads,
    noScatter: !engine.particles.some((q) => q.expireLife !== undefined),
    noStabilityDrain: engine.stability >= before.stability - 0.001,
  };
});
check(
  'Controlled Burn: scores instead of popping (no scatter, no drain)',
  burn.gainedScore && burn.overloadsUnchanged && burn.noScatter && burn.noStabilityDrain,
  JSON.stringify(burn),
);

// --- Pressure Valve: capacity-aware auto-collect, no re-overload loop ---
const valve = await page.evaluate(async () => {
  const { engine, CONFIG, boosts } = window.__fizzion;
  boosts.resetRunMods();
  boosts.applyBoost('pressure_valve');
  const orb = engine.orb;
  const c = '#00ff88';
  // Park in a corner, away from the portal, and pop the orb.
  orb.x = 60;
  orb.y = 760;
  orb.vx = 0;
  orb.vy = 0;
  orb.pips = [c, c, c];
  orb.color = c;
  orb.mass = CONFIG.overloadMass - 1;
  const overloadsBefore = engine.overloads;
  engine.particles.push({
    x: orb.x, y: orb.y, vx: 0, vy: 0, color: c, phase: 0,
    state: 'attract', ax: orb.x, ay: orb.y, attractT: 1,
  });
  await new Promise((r) => setTimeout(r, 250)); // pop lands, grace still on
  // Step clear of the debris field so only the valve's pull (not natural
  // proximity collection) is measured.
  engine.orb.x = 330;
  engine.orb.y = 140;
  engine.orb.vx = 0;
  engine.orb.vy = 0;
  // Grace (0.5s) + auto-collect flight time: plenty for a loop to show.
  await new Promise((r) => setTimeout(r, 2250));
  return {
    extraOverloads: engine.overloads - overloadsBefore,
    mass: engine.orb.mass,
    fillTo: CONFIG.boostValveMaxMass,
    collectedSome: engine.orb.mass > 5,
  };
});
check(
  'Pressure Valve: refills only to the working-mass cap, never re-pops the orb',
  valve.extraOverloads === 1 && valve.mass <= valve.fillTo && valve.collectedSome,
  JSON.stringify(valve),
);

// --- Offer pacing: a relocation inside the min gap defers its offer ---
const offerGap = await page.evaluate(async () => {
  const { engine, CONFIG, useGameStore } = window.__fizzion;
  CONFIG.boostFirstAt = 3; // re-enable offers for this test
  CONFIG.boostOfferDelayMs = 50;
  CONFIG.relocateMinDistFrac = 0.25;
  useGameStore.getState().beginRound();
  engine.startRound();
  engine.particles.length = 0;
  await new Promise((r) => setTimeout(r, 300));

  const c = '#00ff88';
  const forceDeliver = async () => {
    engine.orb.x = 60;
    engine.orb.y = 760;
    await new Promise((r) => setTimeout(r, 300)); // clear portal contact
    const p = engine.portal;
    p.requestType = 'normal';
    p.color = c;
    p.minMass = 0;
    p.timeLeft = 30;
    p.duration = 30;
    p.rerollLeft = 0;
    engine.orb.pips = [c];
    engine.orb.color = c;
    engine.orb.mass = 2;
    engine.orb.x = p.x;
    engine.orb.y = p.y;
    await new Promise((r) => setTimeout(r, 700)); // hit-stop + celebration
  };

  // Pretend the delivery-3 offer just fired, then force a relocation-eligible
  // delivery inside the gap (delivery 5: 5 - 3 = 2 < boostMinGapDeliveries).
  engine.deliveries = 4; // next delivery hits relocateMinDeliveries (5)
  engine.lastBoostOfferAt = 3;
  engine.runTime = CONFIG.relocateMinTime + 1;
  engine.deliveriesSinceRelocate = 10;
  const portalBefore = { x: engine.portal.x, y: engine.portal.y };
  await forceDeliver();
  await new Promise((r) => setTimeout(r, 400));
  const insideGap = {
    offer: useGameStore.getState().boostOffer,
    relocated:
      Math.hypot(engine.portal.x - portalBefore.x, engine.portal.y - portalBefore.y) > 1,
  };

  // Past the gap (delivery 7: 7 - 3 >= 4) the relocation carries the offer.
  engine.deliveries = 6;
  engine.deliveriesSinceRelocate = 10;
  await forceDeliver();
  await new Promise((r) => setTimeout(r, 400));
  const offer = useGameStore.getState().boostOffer;
  const pastGap = { offer, paused: engine.paused };
  if (offer) useGameStore.getState().chooseBoost(offer[0]); // resume
  CONFIG.boostFirstAt = 9999; // stand down again
  return { insideGap, pastGap };
});
check(
  'relocation inside the offer gap jumps the portal but defers the cards',
  offerGap.insideGap.offer === null && offerGap.insideGap.relocated,
  JSON.stringify(offerGap.insideGap),
);
check(
  'relocation past the offer gap carries the next offer',
  Array.isArray(offerGap.pastGap.offer) &&
    offerGap.pastGap.offer.length === 3 &&
    offerGap.pastGap.paused,
  JSON.stringify(offerGap.pastGap),
);

// --- New permanent upgrades: catalogue -> effects mapping ---
const upgradeMap = await page.evaluate(() => {
  const { useGameStore, upgradeEffects } = window.__fizzion;
  useGameStore.setState({ sparks: 99999 });
  for (const id of ['prospector', 'ward', 'second_chance_plus', 'sticky_drops', 'warm_start']) {
    useGameStore.getState().buyUpgrade(id);
  }
  return { ...upgradeEffects };
});
check(
  'new upgrades map to effects (level 1 each)',
  Math.abs(upgradeMap.sparksMult - 1.1) < 1e-9 &&
    Math.abs(upgradeMap.hazardLifeMult - 0.8) < 1e-9 &&
    Math.abs(upgradeMap.hazardCooldownMult - 1.2) < 1e-9 &&
    Math.abs(upgradeMap.reviveStabilityBonus - 0.15) < 1e-9 &&
    Math.abs(upgradeMap.scatterLifeBonus - 0.5) < 1e-9 &&
    upgradeMap.warmStartBonus === 2,
  JSON.stringify(upgradeMap),
);

// --- Prospector: delivery Sparks scaled by 10% ---
const prospector = await page.evaluate(async () => {
  const { engine, boosts, useGameStore } = window.__fizzion;
  // The offer-gap test ends with cards up and the engine paused: pick one to
  // resume, then wipe run mods so this probe only measures the upgrade.
  const leftover = useGameStore.getState().boostOffer;
  if (leftover) useGameStore.getState().chooseBoost(leftover[0]);
  boosts.resetRunMods();
  const c = '#00ff88';
  engine.chain = 0;
  engine.chainTimeLeft = 0;
  // Park the portal away from the orb: a random relocation may have dropped
  // it on our corner, which would latch p.contact and swallow the delivery.
  engine.portal.x = 340;
  engine.portal.y = 120;
  engine.orb.x = 60;
  engine.orb.y = 760;
  await new Promise((r) => setTimeout(r, 300));
  const p = engine.portal;
  p.contact = false;
  p.requestType = 'normal';
  p.color = c;
  p.minMass = 0;
  p.timeLeft = 30;
  p.duration = 30;
  p.rerollLeft = 0;
  engine.orb.pips = [c];
  engine.orb.color = c;
  engine.orb.mass = 10;
  const sparksBefore = engine.sparksEarned;
  engine.orb.x = p.x;
  engine.orb.y = p.y;
  await new Promise((r) => setTimeout(r, 400));
  return { gained: engine.sparksEarned - sparksBefore, expected: Math.ceil((10 * 1 * 1.1) / 2) };
});
check(
  'Prospector scales delivery Sparks (ceil of +10%)',
  prospector.gained === prospector.expected && prospector.gained === 6,
  JSON.stringify(prospector),
);

// --- Ward: raids spawn shorter, next cooldown longer ---
const ward = await page.evaluate(async () => {
  const { engine, CONFIG } = window.__fizzion;
  engine.hazards.length = 0;
  CONFIG.hazardMaxCount = 2;
  engine.hazardCooldown = 0.05;
  engine.runTime = 1e6; // difficulty pinned at 1
  await new Promise((r) => setTimeout(r, 250));
  const lives = engine.hazards.map((hz) => hz.life);
  const cooldown = engine.hazardCooldown;
  CONFIG.hazardMaxCount = 0;
  engine.hazards.length = 0;
  return {
    lives,
    maxAllowed: CONFIG.hazardLifeMax * 0.8 + 0.05,
    cooldown,
    expectedCooldown: CONFIG.hazardCooldownMin * 1.2,
  };
});
check(
  'Ward shortens raid life 20% and stretches the raid cooldown 20%',
  ward.lives.length === 2 &&
    ward.lives.every((l) => l <= ward.maxAllowed) &&
    Math.abs(ward.cooldown - ward.expectedCooldown) < 0.3,
  JSON.stringify(ward),
);

// --- Sticky Drops: overload debris lives 0.5s longer ---
const sticky = await page.evaluate(async () => {
  const { engine, CONFIG } = window.__fizzion;
  const c = '#00cfff';
  engine.orb.x = 60;
  engine.orb.y = 760;
  engine.orb.vx = 0;
  engine.orb.vy = 0;
  engine.orb.pips = [c, c, c];
  engine.orb.color = c;
  engine.orb.mass = CONFIG.overloadMass - 1;
  engine.particles.push({
    x: engine.orb.x, y: engine.orb.y, vx: 0, vy: 0, color: c, phase: 0,
    state: 'attract', ax: engine.orb.x, ay: engine.orb.y, attractT: 1,
  });
  await new Promise((r) => setTimeout(r, 150));
  const maxLife = Math.max(
    ...engine.particles.filter((q) => q.expireLife !== undefined).map((q) => q.expireLife),
  );
  return { maxLife, base: CONFIG.overloadParticleLife };
});
check(
  'Sticky Drops extends debris lifetime by ~0.5s',
  sticky.maxLife > sticky.base + 0.25,
  `life=${sticky.maxLife.toFixed(2)} base=${sticky.base}`,
);

// --- Warm Start: early requests +2s, gone after the 3rd delivery ---
const warmStart = await page.evaluate(async () => {
  const { engine } = window.__fizzion;
  engine.runTime = 1; // difficulty ~0: deterministic normal requests
  const expire = async () => {
    engine.stability = 1;
    engine.portal.rerollLeft = 0;
    engine.portal.lockLeft = 0;
    engine.portal.timeLeft = 0.01;
    await new Promise((r) => setTimeout(r, 200));
    return engine.portal.duration;
  };
  engine.deliveries = 0;
  const early = await expire();
  engine.deliveries = 5;
  const late = await expire();
  return { early, late, diff: early - late };
});
check(
  'Warm Start stretches request timers only before the 3rd delivery',
  Math.abs(warmStart.diff - 2) < 0.2,
  JSON.stringify(warmStart),
);

// --- Second Chance+: revive restores 65% ---
const revivePlus = await page.evaluate(async () => {
  const { engine, useGameStore, CONFIG } = window.__fizzion;
  engine.portal.lockLeft = 0;
  engine.portal.rerollLeft = 0;
  engine.stability = 0.01;
  engine.portal.timeLeft = 0.01;
  await new Promise((r) => setTimeout(r, 600));
  const offered = useGameStore.getState().phase === 'revive';
  engine.revive();
  useGameStore.getState().acceptRevive();
  await new Promise((r) => setTimeout(r, 200));
  return {
    offered,
    stability: engine.stability,
    expected: CONFIG.reviveStability + 0.15,
  };
});
check(
  'Second Chance+ revive restores the boosted stability',
  revivePlus.offered && Math.abs(revivePlus.stability - revivePlus.expected) < 0.05,
  JSON.stringify(revivePlus),
);

// --- Upgrade cost curve: level 1 stays cheap, the total sink is deep ---
const costCurve = await page.evaluate(() => {
  const { UPGRADE_CATALOG } = window.__fizzion;
  const total = UPGRADE_CATALOG.reduce((s, u) => s + u.costs.reduce((a, c) => a + c, 0), 0);
  const cheapestFirst = Math.min(...UPGRADE_CATALOG.map((u) => u.costs[0]));
  const count200 = UPGRADE_CATALOG.flatMap((u) => u.costs).filter((c) => c === 200).length;
  return { total, cheapestFirst, count200 };
});
check(
  'upgrade cost curve: ~49k total sink, cheap entry, 200 stays unique',
  costCurve.total === 49250 && costCurve.cheapestFirst === 150 && costCurve.count200 === 1,
  JSON.stringify(costCurve),
);

// --- Bonus portal: ramp-gated spawn ---
const bonusSpawn = await page.evaluate(async () => {
  const { engine, CONFIG, boosts } = window.__fizzion;
  boosts.resetRunMods();
  CONFIG.bonusRampStart = 0.25; // restore the real gate
  engine.portal.timeLeft = 30; // keep the main portal quiet
  engine.stability = 0.8;

  // Below the gate: a zeroed countdown must not spawn anything.
  engine.runTime = 1;
  engine.bonusCountdown = 0.01;
  await new Promise((r) => setTimeout(r, 250));
  const gated = engine.bonusPortal === null;

  // Past the gate it spawns, colored, short-lived, clear of the main portal.
  engine.runTime = CONFIG.rampDuration;
  engine.bonusCountdown = 0.01;
  await new Promise((r) => setTimeout(r, 300));
  const bp = engine.bonusPortal;
  return {
    gated,
    spawned: bp !== null,
    lifetime: bp ? bp.duration : -1,
    clearOfMain: bp
      ? Math.hypot(bp.x - engine.portal.x, bp.y - engine.portal.y) >= 100
      : false,
  };
});
check(
  'bonus portal spawns only past the ramp gate, away from the main portal',
  bonusSpawn.gated &&
    bonusSpawn.spawned &&
    bonusSpawn.lifetime === 10 &&
    bonusSpawn.clearOfMain,
  JSON.stringify(bonusSpawn),
);

// --- Bonus portal: missing it costs nothing ---
const bonusMiss = await page.evaluate(async () => {
  const { engine, useGameStore } = window.__fizzion;
  engine.portal.timeLeft = 30;
  engine.stability = 0.8;
  const chainBefore = engine.chain;
  engine.bonusPortal.timeLeft = 0.01;
  await new Promise((r) => setTimeout(r, 300));
  return {
    despawned: engine.bonusPortal === null,
    stability: engine.stability,
    chainKept: engine.chain === chainBefore,
    storeCleared: useGameStore.getState().bonusActive === false,
  };
});
check(
  'missed bonus fades with no stability drain and no chain break',
  bonusMiss.despawned &&
    Math.abs(bonusMiss.stability - 0.8) < 0.01 &&
    bonusMiss.chainKept &&
    bonusMiss.storeCleared,
  JSON.stringify(bonusMiss),
);

// --- Bonus delivery: double Sparks, chain bump, no pacing side effects ---
const bonusDeliver = await page.evaluate(async () => {
  const { engine, CONFIG, useGameStore } = window.__fizzion;
  engine.portal.timeLeft = 30;
  engine.chain = 0;
  engine.chainTimeLeft = 0;
  // Park the orb away, then respawn a bonus portal.
  engine.orb.x = 60;
  engine.orb.y = 760;
  engine.bonusCountdown = 0.01;
  await new Promise((r) => setTimeout(r, 300));
  const bp = engine.bonusPortal;
  if (!bp) return { spawned: false };
  const storeSawIt = useGameStore.getState().bonusActive === true;
  bp.rerollLeft = 0; // skip the open animation
  bp.contact = false;
  const c = bp.color;
  engine.orb.pips = [c];
  engine.orb.color = c;
  engine.orb.mass = 10;
  const sparksBefore = engine.sparksEarned;
  const deliveriesBefore = engine.deliveries;
  engine.orb.x = bp.x;
  engine.orb.y = bp.y;
  await new Promise((r) => setTimeout(r, 700)); // hit-stop + celebration
  return {
    spawned: true,
    storeSawIt,
    gained: engine.sparksEarned - sparksBefore,
    // mass 10, chain 1, Prospector 1.1, bonus x2 -> ceil(10*1*1.1*2/2) = 11
    expected: Math.ceil((10 * 1 * 1.1 * CONFIG.bonusSparksMult) / CONFIG.sparksDivisor),
    chain: engine.chain,
    deliveriesUnchanged: engine.deliveries === deliveriesBefore,
    closed: engine.bonusPortal === null,
    // First use retires the persistent coach line (requestsTaught.bonus).
    bonusDeliveries: engine.bonusDeliveries,
    taughtByUse: useGameStore.getState().requestsTaught.bonus === true,
  };
});
check(
  'bonus delivery pays double Sparks, bumps the chain, skips pacing counters',
  bonusDeliver.spawned &&
    bonusDeliver.storeSawIt &&
    bonusDeliver.gained === bonusDeliver.expected &&
    bonusDeliver.gained === 11 &&
    bonusDeliver.chain === 1 &&
    bonusDeliver.deliveriesUnchanged &&
    bonusDeliver.closed,
  JSON.stringify(bonusDeliver),
);
check(
  'first bonus use marks the coach line as taught',
  bonusDeliver.bonusDeliveries === 1 && bonusDeliver.taughtByUse,
  JSON.stringify({
    bonusDeliveries: bonusDeliver.bonusDeliveries,
    taught: bonusDeliver.taughtByUse,
  }),
);

// --- Upgrade trial: +1 level for one run, reverted at round end ---
const trial = await page.evaluate(() => {
  const { useGameStore, upgradeEffects } = window.__fizzion;
  const store = useGameStore.getState();
  useGameStore.setState({ upgrades: { magnet_core: 1, warm_start: 1 } });
  // Maxed upgrades can't be trialed (warm_start maxLevel is 1).
  store.armTrialUpgrade('warm_start');
  const maxedRefused = useGameStore.getState().trialUpgrade === null;
  store.armTrialUpgrade('magnet_core');
  const armed = useGameStore.getState().trialUpgrade;
  store.beginRound();
  const during = upgradeEffects.collectRangeMult; // level 1 + trial = 1.24
  const cleared = useGameStore.getState().trialUpgrade === null;
  useGameStore.getState().finishRound({
    score: 0, bestChain: 0, sparksEarned: 0, deliveries: 0, overloads: 0, duration: 0,
  });
  const after = upgradeEffects.collectRangeMult; // owned level only = 1.12
  return { maxedRefused, armed, during, cleared, after };
});
check(
  'trial plays one run at +1 level then reverts (maxed upgrades refused)',
  trial.maxedRefused &&
    trial.armed === 'magnet_core' &&
    Math.abs(trial.during - 1.24) < 0.001 &&
    trial.cleared &&
    Math.abs(trial.after - 1.12) < 0.001,
  JSON.stringify(trial),
);

// --- Head Start: buying arms it; the run opens with a boost offer ---
const headStart = await page.evaluate(async () => {
  const { engine, CONFIG, useGameStore } = window.__fizzion;
  CONFIG.boostFirstAt = 3;
  CONFIG.boostOfferDelayMs = 50;
  CONFIG.maxParticles = 0;
  CONFIG.hazardMaxCount = 0;
  CONFIG.bonusRampStart = 9;
  // Store side: buying deducts Sparks and arms; beginRound consumes the flag.
  useGameStore.setState({ sparks: 200, headStartArmed: false });
  useGameStore.getState().buyHeadStart();
  const bought = {
    sparks: useGameStore.getState().sparks,
    armed: useGameStore.getState().headStartArmed,
  };
  useGameStore.getState().beginRound();
  const consumed = useGameStore.getState().headStartArmed === false;
  engine.startRound({ headStart: true });
  engine.particles.length = 0;
  await new Promise((r) => setTimeout(r, 1800)); // 1.2s prime + roll margin
  const s = useGameStore.getState();
  const offered = Array.isArray(s.boostOffer) && s.boostOffer.length === 3;
  const paused = engine.paused;
  const stamped = engine.lastBoostOfferAt === 0;
  if (offered) useGameStore.getState().chooseBoost(s.boostOffer[0]);
  await new Promise((r) => setTimeout(r, 100));

  // Min-gap guard: the natural boostFirstAt=3 offer lands inside the gap
  // after a head start (3 - 0 < boostMinGapDeliveries) and must stay quiet.
  const c = '#00ff88';
  const forceDeliver = async () => {
    engine.orb.x = 60;
    engine.orb.y = 760;
    await new Promise((r) => setTimeout(r, 300)); // clear portal contact
    const p = engine.portal;
    p.contact = false;
    p.requestType = 'normal';
    p.color = c;
    p.minMass = 0;
    p.timeLeft = 30;
    p.duration = 30;
    p.rerollLeft = 0;
    engine.orb.pips = [c];
    engine.orb.color = c;
    engine.orb.mass = 2;
    engine.orb.x = p.x;
    engine.orb.y = p.y;
    await new Promise((r) => setTimeout(r, 700)); // hit-stop + celebration
  };
  await forceDeliver();
  await forceDeliver();
  await forceDeliver();
  await new Promise((r) => setTimeout(r, 400));
  const deferred = useGameStore.getState().boostOffer === null && !engine.paused;
  CONFIG.boostFirstAt = 9999; // stand down
  return {
    bought,
    consumed,
    offered,
    paused,
    stamped,
    deliveries: engine.deliveries,
    deferred,
  };
});
check(
  'head start purchase deducts 150 Sparks and arms the flag',
  headStart.bought.sparks === 50 && headStart.bought.armed && headStart.consumed,
  JSON.stringify(headStart.bought),
);
check(
  'head start opens the run with a paused 3-card offer at delivery 0',
  headStart.offered && headStart.paused && headStart.stamped,
  JSON.stringify(headStart),
);
check(
  'first natural offer deferred by the min-gap guard after a head start',
  headStart.deliveries === 3 && headStart.deferred,
  JSON.stringify(headStart),
);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
