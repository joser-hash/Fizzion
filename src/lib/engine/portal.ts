import { CONFIG, GAME_COLORS, type GameColor } from '../constants';
import { clamp, pick, randInt } from './utils';

/**
 * normal: match the majority color (may carry a min-mass demand).
 * rush:   half the time window, double score.
 * pure:   all 3 pips must be the request color; triple score, double restore.
 */
export type RequestType = 'normal' | 'rush' | 'pure';

export interface Portal {
  x: number;
  y: number;
  color: GameColor;
  /** Color the ring is transitioning to mid-reroll. */
  nextColor: GameColor;
  requestType: RequestType;
  timeLeft: number;
  /** Total time of the current request (shrinks with difficulty). */
  duration: number;
  /** Minimum orb mass this request demands (0 = any size). */
  minMass: number;
  rotation: number;
  /** Reroll animation: counts portalRerollMs down to 0 (0 = idle). */
  rerollLeft: number;
  /** Gray flash on wrong-color contact (0..1, decays). */
  rejectFlash: number;
  /** Bright flash on successful delivery (0..1, decays). */
  successFlash: number;
  /** Color Lock: seconds the request timer is frozen. */
  lockLeft: number;
  /** True while the orb overlaps the portal (prevents rejection spam). */
  contact: boolean;
  /** Relocation target, applied at the reroll midpoint (null = stay put). */
  nextX: number | null;
  nextY: number | null;
  /** Set for one frame when the portal re-opens somewhere new. */
  justRelocated: boolean;
}

export function createPortal(): Portal {
  return {
    x: 0,
    y: 0,
    color: pick(GAME_COLORS),
    nextColor: GAME_COLORS[0],
    requestType: 'normal',
    timeLeft: CONFIG.portalTime,
    duration: CONFIG.portalTime,
    minMass: 0,
    rotation: 0,
    rerollLeft: 0,
    rejectFlash: 0,
    successFlash: 0,
    lockLeft: 0,
    contact: false,
    nextX: null,
    nextY: null,
    justRelocated: false,
  };
}

export function layoutPortal(portal: Portal, w: number, h: number): void {
  portal.x = w / 2;
  portal.y = Math.max(h * 0.13, 96);
  portal.nextX = null;
  portal.nextY = null;
  portal.justRelocated = false;
}

/**
 * Pick a relocation target: inside wall margins, at least
 * `relocateMinDistFrac` of the diagonal from the current spot, and away
 * from the orb. Rejection-samples a few tries, keeping the best candidate.
 */
export function pickRelocationSpot(
  portal: Portal,
  w: number,
  h: number,
  orbX: number,
  orbY: number,
): void {
  const minDist = Math.hypot(w, h) * CONFIG.relocateMinDistFrac;
  let bestX = portal.x;
  let bestY = portal.y;
  let bestScore = -Infinity;
  for (let i = 0; i < 20; i++) {
    const x = w * (0.15 + Math.random() * 0.7);
    const y = h * (0.12 + Math.random() * 0.66);
    const dPortal = Math.hypot(x - portal.x, y - portal.y);
    const dOrb = Math.hypot(x - orbX, y - orbY);
    // Lexicographic preference: jump distance is the hard constraint,
    // orb clearance is nice-to-have, raw distances break ties — so
    // relocation never silently fails to actually move.
    const rank = (dPortal >= minDist ? 2 : 0) + (dOrb >= 180 ? 1 : 0);
    const score = rank * 1e6 + dPortal + dOrb * 0.25;
    if (score > bestScore) {
      bestScore = score;
      bestX = x;
      bestY = y;
    }
    if (rank === 3 && i >= 3) break;
  }
  portal.nextX = bestX;
  portal.nextY = bestY;
}

/**
 * Trigger the collapse/re-expand reroll animation into a different color.
 * Difficulty (0..1) shrinks the request time and can add a minimum-mass
 * demand once past the ramp start.
 */
function rampFrac(difficulty: number, start: number): number {
  return clamp((difficulty - start) / (1 - start), 0, 1);
}

export function rerollPortal(portal: Portal, difficulty: number): void {
  const others = GAME_COLORS.filter((c) => c !== portal.color);
  portal.nextColor = pick(others);
  portal.rerollLeft = CONFIG.portalRerollMs;

  // Request type: weights grow with difficulty; all-normal early on.
  const pRush = rampFrac(difficulty, CONFIG.rushRampStart) * CONFIG.rushMaxChance;
  const pPure = rampFrac(difficulty, CONFIG.pureRampStart) * CONFIG.pureMaxChance;
  const roll = Math.random();
  portal.requestType = roll < pPure ? 'pure' : roll < pPure + pRush ? 'rush' : 'normal';

  const baseTime =
    CONFIG.portalTime + (CONFIG.portalTimeMin - CONFIG.portalTime) * clamp(difficulty, 0, 1);
  portal.duration = portal.requestType === 'rush' ? baseTime * CONFIG.rushTimeFactor : baseTime;
  portal.timeLeft = portal.duration;

  // Min-mass demands apply to normal requests only, keeping each readable.
  const frac = rampFrac(difficulty, CONFIG.minMassRampStart);
  if (portal.requestType === 'normal' && frac > 0 && Math.random() < 0.35 + 0.4 * frac) {
    portal.minMass = randInt(3, Math.max(3, Math.round(3 + frac * (CONFIG.minMassMax - 3))));
  } else {
    portal.minMass = 0;
  }
}

/** Returns true when the request expired this frame (caller rerolls). */
export function updatePortal(portal: Portal, dt: number): boolean {
  portal.rotation += dt * (portal.requestType === 'rush' ? 2.3 : 0.9);
  portal.rejectFlash = Math.max(0, portal.rejectFlash - dt * 3);
  portal.successFlash = Math.max(0, portal.successFlash - dt * 2.5);

  if (portal.rerollLeft > 0) {
    const prev = portal.rerollLeft;
    portal.rerollLeft = Math.max(0, portal.rerollLeft - dt * 1000);
    const half = CONFIG.portalRerollMs / 2;
    if (prev > half && portal.rerollLeft <= half) {
      portal.color = portal.nextColor;
      // Fully shrunk: teleport now so it visibly re-opens somewhere new.
      if (portal.nextX !== null && portal.nextY !== null) {
        portal.x = portal.nextX;
        portal.y = portal.nextY;
        portal.nextX = null;
        portal.nextY = null;
        portal.justRelocated = true;
      }
    }
    return false;
  }

  if (portal.lockLeft > 0) {
    portal.lockLeft = Math.max(0, portal.lockLeft - dt);
    return false;
  }

  portal.timeLeft -= dt;
  return portal.timeLeft <= 0;
}

/** Visual scale during the reroll collapse/expand (1 = normal). */
export function portalScale(portal: Portal): number {
  if (portal.rerollLeft <= 0) return 1;
  const p = 1 - portal.rerollLeft / CONFIG.portalRerollMs; // 0 -> 1
  return p < 0.5 ? 1 - p * 2 : (p - 0.5) * 2;
}
