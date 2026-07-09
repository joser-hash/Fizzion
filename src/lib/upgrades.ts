/**
 * Live upgrade effects derived from owned upgrade levels. Pure TS with no
 * React imports so the engine can read it directly; the store calls
 * applyUpgradeLevels on load and after every purchase.
 */
export interface UpgradeEffects {
  /** Multiplier on stability drain from missed requests (1 = no upgrade). */
  expireDrainMult: number;
  /** Multiplier on the orb's particle collect range. */
  collectRangeMult: number;
  /** Added to the overload mass threshold. */
  overloadBonus: number;
  /** Color Lock charges granted at run start. */
  startColorLock: number;
  /** Multiplier on Sparks earned from deliveries (Prospector). */
  sparksMult: number;
  /** Multiplier on pip thief raid duration (Ward, < 1 shortens). */
  hazardLifeMult: number;
  /** Multiplier on the cooldown between raids (Ward, > 1 spaces them out). */
  hazardCooldownMult: number;
  /** Added to the stability a Second Chance revive restores. */
  reviveStabilityBonus: number;
  /** Seconds added to overload debris lifetime (Sticky Drops). */
  scatterLifeBonus: number;
  /** Seconds added to request timers before the 3rd delivery (Warm Start). */
  warmStartBonus: number;
}

export const upgradeEffects: UpgradeEffects = {
  expireDrainMult: 1,
  collectRangeMult: 1,
  overloadBonus: 0,
  startColorLock: 0,
  sparksMult: 1,
  hazardLifeMult: 1,
  hazardCooldownMult: 1,
  reviveStabilityBonus: 0,
  scatterLifeBonus: 0,
  warmStartBonus: 0,
};

export function applyUpgradeLevels(levels: Record<string, number>): void {
  upgradeEffects.expireDrainMult = Math.pow(0.88, levels['reinforced_portal'] ?? 0);
  upgradeEffects.collectRangeMult = 1 + 0.12 * (levels['magnet_core'] ?? 0);
  upgradeEffects.overloadBonus = levels['dense_shell'] ?? 0;
  upgradeEffects.startColorLock = levels['lock_battery'] ?? 0;
  upgradeEffects.sparksMult = 1 + 0.1 * (levels['prospector'] ?? 0);
  upgradeEffects.hazardLifeMult = Math.pow(0.8, levels['ward'] ?? 0);
  upgradeEffects.hazardCooldownMult = Math.pow(1.2, levels['ward'] ?? 0);
  upgradeEffects.reviveStabilityBonus = 0.15 * (levels['second_chance_plus'] ?? 0);
  upgradeEffects.scatterLifeBonus = 0.5 * (levels['sticky_drops'] ?? 0);
  upgradeEffects.warmStartBonus = 2 * (levels['warm_start'] ?? 0);
}
