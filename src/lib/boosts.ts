/**
 * In-run roguelite boosts. Mirrors the upgrades.ts pattern: `runMods` is a
 * plain mutable object the engine (and renderer) read directly every frame —
 * pure TS with no React imports. Reset at round start; boosts stack onto it
 * as the player picks them mid-run.
 */
export type BoostRarity = 'common' | 'rare' | 'epic';

export interface BoostDef {
  id: string;
  name: string;
  desc: string;
  rarity: BoostRarity;
  apply(mods: RunMods): void;
}

export interface RunMods {
  /** Long Fuse: seconds added to the chain window. */
  chainWindowBonus: number;
  /** Tuner: seconds added to every portal request. */
  requestTimeBonus: number;
  /** Bounty: Sparks paid whenever a thief's raid ends. */
  thiefBounty: number;
  /** Featherweight: multiplier on swipe impulse. */
  impulseMult: number;
  /** Pressure Valve: overload scatter auto-collects after its grace period. */
  scatterAutoCollect: boolean;
  /** Insurance: chain-break shield charges (consumed one per break). */
  chainShields: number;
  /** Prism: extra pip slots beyond CONFIG.pipCount. */
  pipBonus: number;
  /** Controlled Burn: overloading on the portal delivers half mass instead. */
  controlledBurn: boolean;
  /** Chain Reactor: chain breaks halve the chain instead of resetting it. */
  chainReactor: boolean;
}

const DEFAULT_MODS: RunMods = {
  chainWindowBonus: 0,
  requestTimeBonus: 0,
  thiefBounty: 0,
  impulseMult: 1,
  scatterAutoCollect: false,
  chainShields: 0,
  pipBonus: 0,
  controlledBurn: false,
  chainReactor: false,
};

export const runMods: RunMods = { ...DEFAULT_MODS };

export function resetRunMods(): void {
  Object.assign(runMods, DEFAULT_MODS);
}

export const BOOST_CATALOG: readonly BoostDef[] = [
  // --- Common ---
  {
    id: 'long_fuse',
    name: 'Long Fuse',
    desc: 'Chain window lasts 4s longer',
    rarity: 'common',
    apply: (m) => {
      m.chainWindowBonus += 4;
    },
  },
  {
    id: 'tuner',
    name: 'Tuner',
    desc: 'Every portal request lasts 2s longer',
    rarity: 'common',
    apply: (m) => {
      m.requestTimeBonus += 2;
    },
  },
  {
    id: 'bounty',
    name: 'Bounty',
    desc: 'Pip thieves pay 15 Sparks when their raid ends',
    rarity: 'common',
    apply: (m) => {
      m.thiefBounty += 15;
    },
  },
  // --- Rare ---
  {
    id: 'featherweight',
    name: 'Featherweight',
    desc: 'Swipes push 25% harder',
    rarity: 'rare',
    apply: (m) => {
      m.impulseMult *= 1.25;
    },
  },
  {
    id: 'pressure_valve',
    name: 'Pressure Valve',
    desc: 'Overload debris flies back to you on its own',
    rarity: 'rare',
    apply: (m) => {
      m.scatterAutoCollect = true;
    },
  },
  {
    id: 'insurance',
    name: 'Insurance',
    desc: 'The next chain break is forgiven',
    rarity: 'rare',
    apply: (m) => {
      m.chainShields += 1;
    },
  },
  // --- Epic ---
  {
    id: 'prism',
    name: 'Prism',
    desc: 'Carry a 4th pip',
    rarity: 'epic',
    apply: (m) => {
      m.pipBonus += 1;
    },
  },
  {
    id: 'controlled_burn',
    name: 'Controlled Burn',
    desc: 'Overloading on the portal delivers half your mass instead of popping',
    rarity: 'epic',
    apply: (m) => {
      m.controlledBurn = true;
    },
  },
  {
    id: 'chain_reactor',
    name: 'Chain Reactor',
    desc: 'Chain breaks halve your chain instead of resetting it',
    rarity: 'epic',
    apply: (m) => {
      m.chainReactor = true;
    },
  },
] as const;

const RARITY_WEIGHT: Record<BoostRarity, number> = { common: 3, rare: 2, epic: 1 };

export function applyBoost(id: string): void {
  BOOST_CATALOG.find((b) => b.id === id)?.apply(runMods);
}

/**
 * Roll up to 3 rarity-weighted options from the boosts not yet owned this
 * run (weighted sampling without replacement). Empty when the pool is dry.
 */
export function rollBoostOptions(owned: readonly string[]): string[] {
  const pool = BOOST_CATALOG.filter((b) => !owned.includes(b.id));
  const picks: string[] = [];
  while (picks.length < 3 && pool.length > 0) {
    let total = 0;
    for (const b of pool) total += RARITY_WEIGHT[b.rarity];
    let roll = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      roll -= RARITY_WEIGHT[pool[idx].rarity];
      if (roll <= 0) break;
    }
    picks.push(pool[idx].id);
    pool.splice(idx, 1);
  }
  return picks;
}
