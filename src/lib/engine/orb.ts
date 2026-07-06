import { CONFIG, type GameColor } from '../constants';
import { clamp, rand, TAU } from './utils';
import type { Effects } from './effects';

export interface Orb {
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  /** FIFO of the last N particle colors eaten (newest last). */
  pips: GameColor[];
  /** Current majority color, or white before the first pickup. */
  color: string;
  trail: { x: number; y: number }[];
  /** Squash-and-stretch: 0..1 intensity decaying, plus the impact axis. */
  squashT: number;
  squashAngle: number;
  /** Quick uniform scale pop when eating (decays to 0). */
  bounceScale: number;
  /** Wandering direction of the constant gentle drift. */
  driftAngle: number;
  /** Consecutive pickups matching the current majority (drives pop pitch). */
  streak: number;
  /** Red "a hazard just stole from me" flash (0..1, decays). */
  stolenFlash: number;
}

export function createOrb(x: number, y: number): Orb {
  return {
    x,
    y,
    vx: rand(-30, 30),
    vy: rand(-30, 30),
    mass: 1,
    pips: [],
    color: '#ffffff',
    trail: [],
    squashT: 0,
    squashAngle: 0,
    bounceScale: 0,
    driftAngle: rand(0, TAU),
    streak: 0,
    stolenFlash: 0,
  };
}

export function orbRadius(orb: Orb): number {
  return CONFIG.orbBaseRadius * Math.sqrt(orb.mass);
}

/**
 * Majority color among the pips. On a full tie (all different), returns
 * the previous color unchanged.
 */
export function majorityColor(pips: GameColor[], prev: string): string {
  if (pips.length === 0) return prev;
  const counts = new Map<GameColor, number>();
  for (const c of pips) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best: GameColor | null = null;
  let bestN = 0;
  let tied = false;
  for (const [c, n] of counts) {
    if (n > bestN) {
      best = c;
      bestN = n;
      tied = false;
    } else if (n === bestN) {
      tied = true;
    }
  }
  return tied || !best ? prev : best;
}

/** Drag vector -> velocity impulse. Heavier orbs respond more sluggishly. */
export function applyImpulse(orb: Orb, dx: number, dy: number): void {
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const capped = Math.min(len, CONFIG.swipeMaxDrag);
  const scale = (capped / len) * CONFIG.swipeForce;
  const response = 1 / (0.45 + 0.55 * Math.sqrt(orb.mass));
  orb.vx += dx * scale * response;
  orb.vy += dy * scale * response;
  orb.driftAngle = Math.atan2(orb.vy, orb.vx);
}

export function updateOrb(orb: Orb, dt: number, w: number, h: number, effects: Effects): void {
  const tickScale = dt * CONFIG.targetTickRate;
  const friction = Math.pow(CONFIG.friction, tickScale);
  orb.vx *= friction;
  orb.vy *= friction;

  // Constant gentle drift in a slowly wandering direction; slightly
  // stronger with mass so heavy orbs feel like they carry momentum.
  orb.driftAngle += rand(-1.6, 1.6) * dt;
  const driftAccel = 26 * (0.7 + 0.3 * Math.sqrt(orb.mass));
  orb.vx += Math.cos(orb.driftAngle) * driftAccel * dt;
  orb.vy += Math.sin(orb.driftAngle) * driftAccel * dt;

  // Never stop dead.
  const speed = Math.hypot(orb.vx, orb.vy);
  if (speed > 0 && speed < CONFIG.minDriftSpeed) {
    const k = CONFIG.minDriftSpeed / speed;
    orb.vx *= k;
    orb.vy *= k;
  }
  if (speed > CONFIG.maxSpeed) {
    const k = CONFIG.maxSpeed / speed;
    orb.vx *= k;
    orb.vy *= k;
  }

  orb.x += orb.vx * dt;
  orb.y += orb.vy * dt;

  const r = orbRadius(orb);
  const bounce = CONFIG.wallBounce;
  let hit = false;
  let hitSpeed = 0;
  if (orb.x - r < 0) {
    orb.x = r;
    hitSpeed = Math.abs(orb.vx);
    orb.vx = Math.abs(orb.vx) * bounce;
    orb.squashAngle = 0;
    hit = true;
  } else if (orb.x + r > w) {
    orb.x = w - r;
    hitSpeed = Math.abs(orb.vx);
    orb.vx = -Math.abs(orb.vx) * bounce;
    orb.squashAngle = 0;
    hit = true;
  }
  if (orb.y - r < 0) {
    orb.y = r;
    hitSpeed = Math.max(hitSpeed, Math.abs(orb.vy));
    orb.vy = Math.abs(orb.vy) * bounce;
    orb.squashAngle = Math.PI / 2;
    hit = true;
  } else if (orb.y + r > h) {
    orb.y = h - r;
    hitSpeed = Math.max(hitSpeed, Math.abs(orb.vy));
    orb.vy = -Math.abs(orb.vy) * bounce;
    orb.squashAngle = Math.PI / 2;
    hit = true;
  }
  if (hit && hitSpeed > 60) {
    orb.squashT = clamp(hitSpeed / 700, 0.25, 1);
    if (hitSpeed > 350) effects.burst(orb.x, orb.y, orb.color, 3, 90);
  }

  orb.squashT = Math.max(0, orb.squashT - dt * 5);
  orb.bounceScale = Math.max(0, orb.bounceScale - dt * 1.4);
  orb.stolenFlash = Math.max(0, orb.stolenFlash - dt * 1.7);

  orb.trail.push({ x: orb.x, y: orb.y });
  while (orb.trail.length > CONFIG.trailLength) orb.trail.shift();
}
