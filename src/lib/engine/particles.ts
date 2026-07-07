import { CONFIG, GAME_COLORS, type GameColor } from '../constants';
import { upgradeEffects } from '../upgrades';
import { dist, easeInQuad, pick, rand, randInt, TAU } from './utils';
import type { Orb } from './orb';
import { orbRadius } from './orb';

export interface FoodParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: GameColor;
  phase: number;
  state: 'idle' | 'attract';
  /** Attract animation origin + progress (0..1 over collectAttractMs). */
  ax: number;
  ay: number;
  attractT: number;
  /** Set for overload-scattered particles: seconds until they vanish. */
  expireLife?: number;
  /** Seconds before the particle can be collected (overload scatter grace). */
  collectDelay?: number;
}

function makeParticle(x: number, y: number, color: GameColor): FoodParticle {
  return {
    x,
    y,
    vx: rand(-12, 12),
    vy: rand(-12, 12),
    color,
    phase: rand(0, TAU),
    state: 'idle',
    ax: 0,
    ay: 0,
    attractT: 0,
  };
}

/** Count of regular (non-expiring) food particles. */
export function foodCount(list: FoodParticle[]): number {
  let n = 0;
  for (const p of list) if (p.expireLife === undefined) n++;
  return n;
}

/**
 * Spawn one loose same-color cluster (3-6 particles scattered around a
 * center), avoiding the portal zone, the orb, and screen edges.
 */
export function spawnCluster(
  list: FoodParticle[],
  w: number,
  h: number,
  portalX: number,
  portalY: number,
  orb: Orb,
  colors: readonly GameColor[] = GAME_COLORS,
): void {
  const margin = 24;
  const color = pick(colors);
  let cx = 0;
  let cy = 0;
  for (let attempt = 0; attempt < 24; attempt++) {
    cx = rand(margin, w - margin);
    cy = rand(margin + 40, h - margin);
    const portalClear = dist(cx, cy, portalX, portalY) > CONFIG.portalRadius * 2.4;
    const orbClear = dist(cx, cy, orb.x, orb.y) > orbRadius(orb) * 3 + 40;
    if (portalClear && orbClear) break;
  }
  const n = randInt(CONFIG.clusterMin, CONFIG.clusterMax);
  const room = CONFIG.maxParticles - foodCount(list);
  for (let i = 0; i < Math.min(n, room); i++) {
    const a = rand(0, TAU);
    const d = rand(8, CONFIG.clusterRadius);
    const x = Math.min(Math.max(cx + Math.cos(a) * d, margin), w - margin);
    const y = Math.min(Math.max(cy + Math.sin(a) * d, margin), h - margin);
    list.push(makeParticle(x, y, color));
  }
}

/** Scatter `count` expiring particles outward from an overload explosion. */
export function scatterOverload(
  list: FoodParticle[],
  x: number,
  y: number,
  count: number,
  colors: GameColor[],
): void {
  for (let i = 0; i < count; i++) {
    const a = rand(0, TAU);
    const off = rand(10, 25);
    const p = makeParticle(x + Math.cos(a) * off, y + Math.sin(a) * off, pick(colors));
    const s = rand(180, 460);
    p.vx = Math.cos(a) * s;
    p.vy = Math.sin(a) * s;
    p.expireLife = CONFIG.overloadParticleLife;
    p.collectDelay = CONFIG.overloadCollectDelay;
    list.push(p);
  }
}

/**
 * Move particles; returns particles whose attract animation finished
 * (i.e. they were fully sucked into the orb this frame).
 */
export function updateParticles(
  list: FoodParticle[],
  dt: number,
  orb: Orb,
  w: number,
  h: number,
): FoodParticle[] {
  const consumed: FoodParticle[] = [];
  const damp = Math.pow(0.4, dt);
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.phase += dt * 3;
    if (p.collectDelay !== undefined && p.collectDelay > 0) {
      p.collectDelay -= dt;
    }

    if (p.state === 'attract') {
      p.attractT += (dt * 1000) / CONFIG.collectAttractMs;
      const t = Math.min(p.attractT, 1);
      const e = easeInQuad(t);
      p.x = p.ax + (orb.x - p.ax) * e;
      p.y = p.ay + (orb.y - p.ay) * e;
      if (p.attractT >= 1) {
        consumed.push(p);
        list.splice(i, 1);
      }
      continue;
    }

    if (p.expireLife !== undefined) {
      p.expireLife -= dt;
      if (p.expireLife <= 0) {
        list.splice(i, 1);
        continue;
      }
      p.vx *= damp;
      p.vy *= damp;
    }

    // Gentle drift + soft edge wrap-back.
    p.x += p.vx * dt + Math.sin(p.phase) * 4 * dt;
    p.y += p.vy * dt + Math.cos(p.phase * 0.7) * 4 * dt;
    if (p.x < 6) p.vx = Math.abs(p.vx);
    if (p.x > w - 6) p.vx = -Math.abs(p.vx);
    if (p.y < 6) p.vy = Math.abs(p.vy);
    if (p.y > h - 6) p.vy = -Math.abs(p.vy);
  }
  return consumed;
}

/** Flag particles within collection range to start their suck-in animation. */
export function beginAttracts(list: FoodParticle[], orb: Orb): void {
  const range =
    (orbRadius(orb) * CONFIG.collectRangeFactor + CONFIG.particleRadius) *
    upgradeEffects.collectRangeMult;
  for (const p of list) {
    if (p.state !== 'idle') continue;
    if (p.collectDelay !== undefined && p.collectDelay > 0) continue;
    if (dist(p.x, p.y, orb.x, orb.y) < range) {
      p.state = 'attract';
      p.ax = p.x;
      p.ay = p.y;
      p.attractT = 0;
    }
  }
}
