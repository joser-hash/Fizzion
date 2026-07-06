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
}

export const upgradeEffects: UpgradeEffects = {
  expireDrainMult: 1,
  collectRangeMult: 1,
  overloadBonus: 0,
  startColorLock: 0,
};

export function applyUpgradeLevels(levels: Record<string, number>): void {
  upgradeEffects.expireDrainMult = Math.pow(0.88, levels['reinforced_portal'] ?? 0);
  upgradeEffects.collectRangeMult = 1 + 0.12 * (levels['magnet_core'] ?? 0);
  upgradeEffects.overloadBonus = levels['dense_shell'] ?? 0;
  upgradeEffects.startColorLock = levels['lock_battery'] ?? 0;
}
