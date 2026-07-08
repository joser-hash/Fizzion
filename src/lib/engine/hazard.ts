import { CONFIG } from '../constants';
import { lerp, rand, TAU } from './utils';
import type { Orb } from './orb';
import { majorityColor, orbRadius } from './orb';

/**
 * The pip thief: a slow-seeking anti-particle that steals the orb's newest
 * pip on contact, then flees before hunting again. It attacks tempo and
 * material only — never stability or the chain. Raids are events: each
 * thief lives for a limited window, then flickers out.
 */
export interface Hazard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /**
   * spawning: harmless flicker-in; hunting: seeks orb; fleeing: retreats;
   * despawning: harmless flicker-out before removal.
   */
  state: 'spawning' | 'hunting' | 'fleeing' | 'despawning';
  /** Seconds left in the current state (spawning/fleeing/despawning countdowns). */
  stateT: number;
  /** Raid lifetime remaining (s); at zero the thief dissipates. */
  life: number;
  /** Free-running phase for wobble and render flicker. */
  phase: number;
}

/** Spawn at a random edge-biased point at least `hazardSpawnMinDist` from the orb. */
export function spawnHazard(orb: Orb, w: number, h: number, difficulty: number): Hazard {
  let x = w / 2;
  let y = h / 2;
  for (let i = 0; i < 10; i++) {
    x = rand(w * 0.1, w * 0.9);
    y = rand(h * 0.1, h * 0.9);
    if (Math.hypot(x - orb.x, y - orb.y) >= CONFIG.hazardSpawnMinDist) break;
  }
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    state: 'spawning',
    stateT: CONFIG.hazardSpawnTelegraph,
    life: lerp(CONFIG.hazardLifeMin, CONFIG.hazardLifeMax, difficulty),
    phase: rand(0, TAU),
  };
}

export interface StealResult {
  stole: boolean;
  bounced: boolean;
  /** True once the flicker-out finished: remove this hazard. */
  expired: boolean;
}

/**
 * Advance one hazard. Returns what happened on orb contact this frame so
 * the engine can fire feedback (effects/audio/haptics).
 */
export function updateHazard(hz: Hazard, dt: number, orb: Orb, w: number, h: number): StealResult {
  hz.phase += dt * 7;
  const result: StealResult = { stole: false, bounced: false, expired: false };

  if (hz.state === 'spawning') {
    hz.stateT -= dt;
    if (hz.stateT <= 0) hz.state = 'hunting';
    return result; // harmless telegraph
  }

  if (hz.state === 'despawning') {
    hz.stateT -= dt;
    if (hz.stateT <= 0) result.expired = true;
    return result; // harmless flicker-out, frozen in place
  }

  // The raid clock only ticks while the thief is actually a threat.
  hz.life -= dt;
  if (hz.life <= 0) {
    hz.state = 'despawning';
    hz.stateT = CONFIG.hazardDespawnTime;
    return result;
  }

  if (hz.state === 'fleeing') {
    hz.stateT -= dt;
    if (hz.stateT <= 0) hz.state = 'hunting';
  }

  // Steering: hunt toward the orb, or flee toward the farthest corner.
  let tx: number;
  let ty: number;
  if (hz.state === 'fleeing') {
    tx = hz.x < w / 2 ? w * 0.92 : w * 0.08;
    ty = hz.y < h / 2 ? h * 0.92 : h * 0.08;
    // Actually run from the orb, not just to a corner, when it's close.
    if (Math.hypot(orb.x - hz.x, orb.y - hz.y) < 160) {
      tx = hz.x + (hz.x - orb.x);
      ty = hz.y + (hz.y - orb.y);
    }
  } else {
    tx = orb.x;
    ty = orb.y;
  }
  const speed =
    hz.state === 'fleeing' ? CONFIG.hazardSpeed * CONFIG.hazardFleeFactor : CONFIG.hazardSpeed;
  const d = Math.hypot(tx - hz.x, ty - hz.y) || 1;
  // Lazy sine wobble makes the hunt feel alive without adding real speed.
  const wobble = Math.sin(hz.phase * 0.6) * 0.5;
  const ang = Math.atan2(ty - hz.y, tx - hz.x) + (hz.state === 'hunting' ? wobble : 0);
  hz.vx = Math.cos(ang) * speed * Math.min(1, d / 40);
  hz.vy = Math.sin(ang) * speed * Math.min(1, d / 40);
  hz.x += hz.vx * dt;
  hz.y += hz.vy * dt;

  // Contact (hunting only).
  if (hz.state === 'hunting') {
    const hitDist = orbRadius(orb) + CONFIG.hazardRadius;
    const dist = Math.hypot(orb.x - hz.x, orb.y - hz.y);
    if (dist < hitDist) {
      if (orb.pips.length > 0) {
        // Steal the newest pip but leave mass alone: the orb stays just as
        // heavy and overload-prone, so a bite never relieves instability.
        orb.pips.pop();
        orb.color = majorityColor(orb.pips, orb.color);
        orb.stolenFlash = 1;
        result.stole = true;
      } else {
        result.bounced = true;
      }
      // Knock the orb away either way; the thief turns and runs.
      const n = dist > 0.5 ? dist : 1;
      const nx = dist > 0.5 ? (orb.x - hz.x) / n : 1;
      const ny = dist > 0.5 ? (orb.y - hz.y) / n : 0;
      const kick = result.stole ? 260 : 140;
      orb.vx += nx * kick;
      orb.vy += ny * kick;
      hz.state = 'fleeing';
      hz.stateT = CONFIG.hazardFleeTime;
    }
  }

  return result;
}
