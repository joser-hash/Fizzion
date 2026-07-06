/** The four gameplay colors. Order matters only for indexing. */
export const GAME_COLORS = ['#00ff88', '#ff2975', '#00cfff', '#ffd500'] as const;
export type GameColor = (typeof GAME_COLORS)[number];

export interface IapProduct {
  id: string;
  title: string;
  priceUsd: number;
  type: 'non_consumable' | 'consumable' | 'cosmetic';
  /** Sparks granted, for currency packs. */
  sparks?: number;
}

/** Permanent upgrades bought with Sparks (the soft-currency sink). */
export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  maxLevel: number;
  /** Sparks cost for each level (index = current level). */
  costs: number[];
}

export const UPGRADE_CATALOG: readonly UpgradeDef[] = [
  {
    id: 'reinforced_portal',
    name: 'Reinforced Portal',
    desc: '-12% stability damage from missed requests, per level',
    maxLevel: 3,
    costs: [200, 500, 1200],
  },
  {
    id: 'magnet_core',
    name: 'Magnet Core',
    desc: '+12% particle collect range, per level',
    maxLevel: 3,
    costs: [150, 400, 1000],
  },
  {
    id: 'dense_shell',
    name: 'Dense Shell',
    desc: '+1 overload threshold, per level',
    maxLevel: 3,
    costs: [250, 600, 1400],
  },
  {
    id: 'lock_battery',
    name: 'Lock Battery',
    desc: 'Start every run with a Color Lock charge',
    maxLevel: 1,
    costs: [800],
  },
] as const;

export const IAP_CATALOG: readonly IapProduct[] = [
  { id: 'remove_ads', title: 'Remove Ads', priceUsd: 3.99, type: 'non_consumable' },
  { id: 'sparks_small', title: '500 Sparks', priceUsd: 0.99, type: 'consumable', sparks: 500 },
  { id: 'sparks_medium', title: '3000 Sparks', priceUsd: 4.99, type: 'consumable', sparks: 3000 },
  { id: 'sparks_large', title: '8000 Sparks', priceUsd: 9.99, type: 'consumable', sparks: 8000 },
  { id: 'theme_aurora', title: 'Aurora Theme (coming soon)', priceUsd: 1.99, type: 'cosmetic' },
] as const;

/**
 * ALL gameplay tuning values. Mutable at runtime via the debug panel —
 * the engine always reads from this live object.
 */
export const CONFIG = {
  // --- Timing ---
  /** Reference tick rate physics constants are expressed at (Hz). */
  targetTickRate: 60,
  /** Max delta per frame (ms); clamps physics after tab-switch. */
  maxDeltaMs: 50,

  // --- Run stability (endless mode: the run's life bar) ---
  /** Stability lost when a portal request expires unanswered. */
  stabilityDrainExpire: 0.16,
  /** Stability lost when the orb overloads. */
  stabilityDrainOverload: 0.1,
  /** Stability restored per successful delivery. */
  stabilityRestoreDelivery: 0.08,
  /** Extra stability restored per chain level above 1. */
  stabilityChainBonus: 0.01,
  /** Below this fraction the bar blinks and the warn heartbeat plays. */
  stabilityWarnAt: 0.3,

  // --- Difficulty ramp ---
  /** Seconds of run time until the difficulty ramp is fully applied. */
  rampDuration: 180,
  /** Portal request time shrinks toward this floor as difficulty ramps. */
  portalTimeMin: 6,
  /** Ramp fraction at which minimum-mass requests start appearing. */
  minMassRampStart: 0.25,
  /** Largest minimum mass a request can demand. */
  minMassMax: 8,

  // --- Request variety ---
  /** Rush requests: shorter window, doubled score. */
  rushTimeFactor: 0.5,
  rushScoreMult: 2,
  /** Ramp fraction where rush requests start appearing / their max chance. */
  rushRampStart: 0.15,
  rushMaxChance: 0.25,
  /** Pure requests: all 3 pips must match; tripled score, doubled restore. */
  pureScoreMult: 3,
  pureRestoreMult: 2,
  pureRampStart: 0.4,
  pureMaxChance: 0.2,

  // --- Physics ---
  /** Velocity multiplier per tick at the reference rate. */
  friction: 0.98,
  /** Impulse scale: (drag px) -> velocity (px/s) added at mass 1. */
  swipeForce: 6,
  /** Max drag length taken into account (px). */
  swipeMaxDrag: 160,
  /** Max orb speed (px/s). */
  maxSpeed: 1400,
  /** Wall bounce restitution. */
  wallBounce: 0.72,
  /** Constant gentle drift speed (px/s) so the orb never stops dead. */
  minDriftSpeed: 18,

  // --- Orb ---
  /** Base radius at mass 1 (px); actual radius = base * sqrt(mass). */
  orbBaseRadius: 12,
  /** Number of trail positions stored. */
  trailLength: 15,
  /** Pips carried (FIFO). */
  pipCount: 3,

  // --- Particles (food) ---
  maxParticles: 40,
  clusterMin: 3,
  clusterMax: 6,
  clusterRadius: 70,
  particleRadius: 5,
  /** Attract animation duration on collection (ms). */
  collectAttractMs: 150,
  /** Distance at which a particle starts getting sucked in (multiple of orb radius). */
  collectRangeFactor: 1.35,

  // --- Portal ---
  /** Seconds a color request lasts. */
  portalTime: 12,
  /** Seconds left when urgency blinking starts. */
  portalUrgencyTime: 3,
  portalRadius: 44,
  /** Reroll collapse/expand animation (ms). */
  portalRerollMs: 450,

  // --- Portal relocation ---
  /** Run seconds AND total deliveries both required before the first move. */
  relocateMinTime: 90,
  relocateMinDeliveries: 5,
  /** Deliveries between moves: lerps max -> min with difficulty. */
  relocateEveryMax: 5,
  relocateEveryMin: 3,
  /** Minimum jump distance as a fraction of the screen diagonal. */
  relocateMinDistFrac: 0.4,

  // --- Hazard (pip thief) ---
  /** Ramp fraction where the first hazard appears (~54s at default ramp). */
  hazardRampStart: 0.3,
  /** Ramp fraction where a second hazard joins. */
  hazardSecondAt: 0.75,
  hazardMaxCount: 2,
  /** Hunting speed (px/s) — well below orb impulse speed. */
  hazardSpeed: 62,
  /** Flee speed multiplier after a successful steal. */
  hazardFleeFactor: 3,
  /** Seconds of harmless flicker-in telegraph. */
  hazardSpawnTelegraph: 1.3,
  /** Seconds spent fleeing after a steal before hunting resumes. */
  hazardFleeTime: 2,
  hazardRadius: 11,
  /** Minimum spawn distance from the orb (px). */
  hazardSpawnMinDist: 200,
  /** Raid lifetime (s): lerps min -> max with difficulty. */
  hazardLifeMin: 12,
  hazardLifeMax: 18,
  /** Seconds between raids (after the last thief dissipates): max -> min with difficulty. */
  hazardCooldownMax: 40,
  hazardCooldownMin: 20,
  /** Flicker-out duration when a raid expires (s). */
  hazardDespawnTime: 0.9,

  // --- Instability / overload ---
  /** Mass at which the instability meter starts filling. */
  instabilityStartMass: 8,
  /** Mass at which the orb overloads. */
  overloadMass: 20,
  /** Instability fraction above which the Stabilize ad button appears. */
  stabilizeOfferThreshold: 0.7,
  /** Instability fraction after watching a Stabilize ad. */
  stabilizeResetTo: 0.5,
  /** Seconds scattered overload particles live before vanishing. */
  overloadParticleLife: 3,
  /** Seconds scattered particles fly out before becoming collectible
   * (prevents the respawned orb from instantly re-eating them). */
  overloadCollectDelay: 0.5,

  // --- Economy ---
  /** Score per delivery = mass * scorePerMass * chain. */
  scorePerMass: 10,
  /** Sparks per delivery = ceil(mass * chain / sparksDivisor). */
  sparksDivisor: 2,

  // --- Juice ---
  hitStopMs: 40,
  shakeSmall: 6,
  shakeBig: 22,
  shakeBigMs: 400,
  shakeSmallMs: 180,
  /** Mass thresholds for delivery celebration tiers: BIG / HUGE / COLOSSAL. */
  deliveryTierMasses: [6, 12, 16] as readonly number[],
  /** Hit-stop per tier (ms), index 0 = normal delivery. */
  deliveryTierHitStop: [40, 70, 100, 130] as readonly number[],
  /** Chain breaks after this many seconds without a delivery. */
  chainWindow: 10,
  /** HUD chain text blinks when this much of the window is left (s). */
  chainWarnAt: 3,
  /** Seconds for combo heat to halve. */
  comboHeatHalfLife: 8,
  /** Combo heat treated as "max" for feedback scaling purposes. */
  comboHeatFull: 40,

  // --- Boosts ---
  /** Color Lock freeze duration (s). */
  colorLockDuration: 5,

  // --- Revive (Second Wind) ---
  /** Stability restored when a rewarded revive is accepted. */
  reviveStability: 0.5,
  /** Seconds the revive offer stays on screen before auto-declining. */
  reviveOfferSeconds: 5,

  // --- Ads ---
  /** Show an interstitial at most every N rounds. */
  interstitialEveryNRounds: 3,
  /** Never show interstitials during the player's first N rounds ever. */
  interstitialGraceRounds: 2,
  /** Mock ad countdown (s). */
  mockAdDuration: 3,

  // --- UI ---
  /** First-round hint visibility (s). */
  hintDuration: 5,
  /** Store write throttle for fast-changing values (Hz). */
  storeUpdateHz: 10,
};

export type GameConfig = typeof CONFIG;
