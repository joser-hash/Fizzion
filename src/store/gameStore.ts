import { create } from 'zustand';
import { engine, type HudSnapshot, type RoundStats } from '../lib/engine/engine';
import type { RequestType } from '../lib/engine/portal';
import {
  CONFIG,
  DAILY_GIFT_MAX,
  DAILY_GIFT_SPARKS,
  HEAD_START_COST,
  IAP_CATALOG,
  UPGRADE_CATALOG,
} from '../lib/constants';
import { applyUpgradeLevels } from '../lib/upgrades';

export type GamePhase = 'menu' | 'playing' | 'revive' | 'results';

export interface PersistedData {
  sparks: number;
  bestScore: number;
  bestChain: number;
  roundsPlayed: number;
  muted: boolean;
  /** Vibration feedback on supported devices. */
  haptics: boolean;
  /** Background music on/off. */
  music: boolean;
  /** Owned permanent upgrade levels by upgrade id (added in save v2). */
  upgrades: Record<string, number>;
  /** Remove Ads purchased (added in save v3). */
  adsRemoved: boolean;
  /** First-run tutorial completed (coach toasts never show again). */
  ftueDone: boolean;
  /** Portal request labels already explained once ("N+", rush, pure, bonus). */
  requestsTaught: { minMass?: boolean; rush?: boolean; pure?: boolean; bonus?: boolean };
  /** FTUE color ramp completed: runs start with the full palette (save v4). */
  colorRampDone: boolean;
  /** Daily Gift rewarded-ad claims for one local calendar day (save v5). */
  dailyGift: { date: string; claimed: number };
  /** A Head Start (boost pick at run start) is queued for the next run (save v5). */
  headStartArmed: boolean;
}

/** Local calendar day key for the Daily Gift reset (device timezone). */
export function todayKey(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Daily Gift claims still available today. */
export function dailyGiftLeft(gift: { date: string; claimed: number }): number {
  return DAILY_GIFT_MAX - (gift.date === todayKey() ? gift.claimed : 0);
}

const SAVE_KEY = 'fizzion_save';
const SAVE_VERSION = 5;

const DEFAULT_PERSISTED: PersistedData = {
  sparks: 0,
  bestScore: 0,
  bestChain: 0,
  roundsPlayed: 0,
  muted: false,
  haptics: true,
  music: true,
  upgrades: {},
  adsRemoved: false,
  ftueDone: false,
  requestsTaught: {},
  colorRampDone: false,
  dailyGift: { date: '', claimed: 0 },
  headStartArmed: false,
};

export function loadPersisted(): PersistedData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { ...DEFAULT_PERSISTED };
    const parsed = JSON.parse(raw) as { version?: number; data?: Partial<PersistedData> };
    if (typeof parsed.data !== 'object' || !parsed.data) return { ...DEFAULT_PERSISTED };
    // Schema versioning: v1 lacks `upgrades`, v2 lacks `adsRemoved`, v3
    // lacks `colorRampDone`; all merge cleanly over defaults. Unknown/future
    // versions fall back to defaults entirely.
    if (parsed.version !== undefined && parsed.version >= 1 && parsed.version <= SAVE_VERSION) {
      const data = {
        ...DEFAULT_PERSISTED,
        ...parsed.data,
        upgrades: { ...(parsed.data.upgrades ?? {}) },
        requestsTaught: { ...(parsed.data.requestsTaught ?? {}) },
        dailyGift: { ...DEFAULT_PERSISTED.dailyGift, ...(parsed.data.dailyGift ?? {}) },
      };
      // Migration: players who already learned the game skip the FTUE ramp.
      if (parsed.version < 4 && (data.roundsPlayed > 0 || data.ftueDone)) {
        data.colorRampDone = true;
      }
      return data;
    }
    return { ...DEFAULT_PERSISTED };
  } catch {
    return { ...DEFAULT_PERSISTED };
  }
}

export function savePersisted(data: PersistedData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, data }));
  } catch {
    // Storage unavailable (private mode etc.) — play on without saving.
  }
}

export interface LastRound extends RoundStats {
  /** Whether "Double Down" was already used on this round's Sparks. */
  doubled: boolean;
  newBestScore: boolean;
}

interface GameStore extends PersistedData {
  phase: GamePhase;

  // Throttled engine sync (drives conditional HUD UI, not the score digits).
  chain: number;
  /** Seconds left before the chain expires without a delivery. */
  chainTimeLeft: number;
  runTime: number;
  stability: number;
  comboHeat: number;
  instability: number;
  colorLockLeft: number;
  pips: number;
  deliveries: number;
  /** Overloads this run (FTUE coach reacts to the first pop). */
  overloads: number;
  /** Current portal request, mirrored for the request coach. */
  requestType: RequestType;
  requestMinMass: number;
  /** A bonus portal is on screen (drives the first-use explainer). */
  bonusActive: boolean;
  /** Bonus deliveries this run (first one retires the explainer forever). */
  bonusDeliveries: number;

  colorLockCharges: number;
  /** Boost pick in progress: option ids while the engine is frozen, else null. */
  boostOffer: string[] | null;
  /** Boosts picked this run (session state — surfaced on the results screen). */
  ownedBoosts: string[];
  /** Upgrade id armed by an ad trial: acts +1 level for the next run only. */
  trialUpgrade: string | null;
  lastRound: LastRound | null;
  /** Stats held while the Second Chance (revive) offer is on screen. */
  pendingStats: RoundStats | null;
  sessionBest: number;
  /** Incremented whenever the chain breaks; HUD uses it to shatter the text. */
  chainBreakNonce: number;

  // Session counters for monetization tuning.
  sessionRounds: number;
  adsShown: number;
  adsSkipped: number;
  roundsSinceInterstitial: number;
  /** A rewarded ad was completed this run (courtesy-skips the interstitial). */
  rewardedThisRun: boolean;

  // Actions
  syncFromEngine(snap: HudSnapshot): void;
  beginRound(): void;
  finishRound(stats: RoundStats): void;
  /** Portal collapsed with a revive available: show the Second Chance offer. */
  offerRevive(stats: RoundStats): void;
  /**
   * Revive accepted (ad watched); caller resumes the engine. Declines go
   * through engine.abandonRevive(), whose onRoundEnd lands in finishRound.
   */
  acceptRevive(): void;
  /** Engine froze for a boost pick: surface the 3-card modal. */
  offerBoosts(options: string[]): void;
  /** Player picked a card: apply it in the engine and resume play. */
  chooseBoost(id: string): void;
  /** Rewarded reroll: replace the offer with a fresh roll (excluding owned). */
  rerollBoosts(): void;
  doubleDown(): void;
  addColorLockCharge(): void;
  useColorLockCharge(): void;
  toggleMute(): void;
  toggleHaptics(): void;
  toggleMusic(): void;
  recordAd(completed: boolean): void;
  markInterstitialShown(): void;
  addSparks(n: number): void;
  notifyChainBreak(): void;
  /** Buy the next level of an upgrade with Sparks; no-op if unaffordable. */
  buyUpgrade(id: string): void;
  /** Apply a successful IAP: grant pack Sparks or set adsRemoved. */
  completePurchase(productId: string): void;
  /** Mark the first-run tutorial as seen forever. */
  completeFtue(): void;
  /** Mark one portal request label as explained forever. */
  markRequestTaught(kind: 'minMass' | 'rush' | 'pure' | 'bonus'): void;
  /** Daily Gift ad completed: grant Sparks (up to the daily cap). */
  claimDailyGift(): void;
  /** Upgrade trial ad completed: the upgrade acts +1 level next run. */
  armTrialUpgrade(id: string): void;
  /** Spend Sparks to queue a boost pick at the top of the next run. */
  buyHeadStart(): void;
}

const initialPersisted = loadPersisted();
applyUpgradeLevels(initialPersisted.upgrades);

export const useGameStore = create<GameStore>((set, get) => ({
  ...initialPersisted,

  phase: 'menu',
  chain: 0,
  chainTimeLeft: 0,
  runTime: 0,
  stability: 1,
  comboHeat: 0,
  instability: 0,
  colorLockLeft: 0,
  pips: 0,
  deliveries: 0,
  overloads: 0,
  requestType: 'normal',
  requestMinMass: 0,
  bonusActive: false,
  bonusDeliveries: 0,
  colorLockCharges: 0,
  boostOffer: null,
  ownedBoosts: [],
  trialUpgrade: null,
  lastRound: null,
  pendingStats: null,
  sessionBest: 0,
  chainBreakNonce: 0,

  sessionRounds: 0,
  adsShown: 0,
  adsSkipped: 0,
  roundsSinceInterstitial: 0,
  rewardedThisRun: false,

  syncFromEngine: (snap) =>
    set((s) => ({
      // Ramp completion is judged here (not at round end) so it sticks even
      // if the run collapses or the tab closes right after the last unlock.
      colorRampDone:
        s.colorRampDone ||
        snap.deliveries >= CONFIG.colorRampUnlocks[CONFIG.colorRampUnlocks.length - 1],
      chain: snap.chain,
      chainTimeLeft: snap.chainTimeLeft,
      runTime: snap.runTime,
      stability: snap.stability,
      comboHeat: snap.comboHeat,
      instability: snap.instability,
      colorLockLeft: snap.colorLockLeft,
      pips: snap.pips,
      deliveries: snap.deliveries,
      overloads: snap.overloads,
      requestType: snap.requestType,
      requestMinMass: snap.requestMinMass,
      bonusActive: snap.bonusActive,
      bonusDeliveries: snap.bonusDeliveries,
    })),

  beginRound: () =>
    set((s) => {
      // Upgrade trial: this run plays with the armed upgrade one level up
      // (capped at max), then finishRound restores the owned levels.
      let effective = s.upgrades;
      if (s.trialUpgrade) {
        const def = UPGRADE_CATALOG.find((u) => u.id === s.trialUpgrade);
        const level = s.upgrades[s.trialUpgrade] ?? 0;
        if (def && level < def.maxLevel) {
          effective = { ...s.upgrades, [s.trialUpgrade]: level + 1 };
        }
      }
      applyUpgradeLevels(effective);
      return {
        phase: 'playing',
        lastRound: null,
        rewardedThisRun: false,
        boostOffer: null,
        ownedBoosts: [],
        trialUpgrade: null,
        headStartArmed: false,
        // Lock Battery: every run starts with at least one Color Lock charge.
        colorLockCharges:
          (effective['lock_battery'] ?? 0) > 0
            ? Math.max(s.colorLockCharges, 1)
            : s.colorLockCharges,
      };
    }),

  finishRound: (stats) => {
    const s = get();
    // Any trial boost from this run expires with it.
    applyUpgradeLevels(s.upgrades);
    set({
      phase: 'results',
      pendingStats: null,
      sparks: s.sparks + stats.sparksEarned,
      bestScore: Math.max(s.bestScore, stats.score),
      bestChain: Math.max(s.bestChain, stats.bestChain),
      sessionBest: Math.max(s.sessionBest, stats.score),
      roundsPlayed: s.roundsPlayed + 1,
      sessionRounds: s.sessionRounds + 1,
      roundsSinceInterstitial: s.roundsSinceInterstitial + 1,
      lastRound: {
        ...stats,
        doubled: false,
        newBestScore: stats.score > s.bestScore,
      },
    });
  },

  offerRevive: (stats) => set({ phase: 'revive', pendingStats: stats }),

  acceptRevive: () => set({ phase: 'playing', pendingStats: null }),

  offerBoosts: (options) => set({ boostOffer: options }),

  chooseBoost: (id) => {
    engine.applyBoost(id);
    set((s) => ({ boostOffer: null, ownedBoosts: [...s.ownedBoosts, id] }));
  },

  rerollBoosts: () => {
    const options = engine.rerollBoosts();
    if (options.length > 0) set({ boostOffer: options });
  },

  doubleDown: () => {
    const s = get();
    if (!s.lastRound || s.lastRound.doubled) return;
    set({
      sparks: s.sparks + s.lastRound.sparksEarned,
      lastRound: { ...s.lastRound, doubled: true },
    });
  },

  addColorLockCharge: () => set((s) => ({ colorLockCharges: s.colorLockCharges + 1 })),
  useColorLockCharge: () =>
    set((s) => ({ colorLockCharges: Math.max(0, s.colorLockCharges - 1) })),

  toggleMute: () => set((s) => ({ muted: !s.muted })),
  toggleHaptics: () => set((s) => ({ haptics: !s.haptics })),
  toggleMusic: () => set((s) => ({ music: !s.music })),

  recordAd: (completed) =>
    set((s) =>
      completed
        ? { adsShown: s.adsShown + 1, rewardedThisRun: true }
        : { adsSkipped: s.adsSkipped + 1 },
    ),

  markInterstitialShown: () => set({ roundsSinceInterstitial: 0 }),

  addSparks: (n) => set((s) => ({ sparks: s.sparks + n })),

  notifyChainBreak: () => set((s) => ({ chainBreakNonce: s.chainBreakNonce + 1 })),

  buyUpgrade: (id) => {
    const s = get();
    const def = UPGRADE_CATALOG.find((u) => u.id === id);
    if (!def) return;
    const level = s.upgrades[id] ?? 0;
    if (level >= def.maxLevel) return;
    const cost = def.costs[level];
    if (s.sparks < cost) return;
    const upgrades = { ...s.upgrades, [id]: level + 1 };
    applyUpgradeLevels(upgrades);
    set({
      sparks: s.sparks - cost,
      upgrades,
      // Buying the real level makes an armed trial of it redundant.
      trialUpgrade: s.trialUpgrade === id ? null : s.trialUpgrade,
    });
  },

  completePurchase: (productId) => {
    const product = IAP_CATALOG.find((p) => p.id === productId);
    if (!product) return;
    if (product.id === 'remove_ads') {
      set({ adsRemoved: true });
    } else if (product.type === 'consumable' && product.sparks) {
      set((s) => ({ sparks: s.sparks + product.sparks! }));
    }
  },

  completeFtue: () => set({ ftueDone: true }),

  markRequestTaught: (kind) =>
    set((s) => ({ requestsTaught: { ...s.requestsTaught, [kind]: true } })),

  claimDailyGift: () => {
    const s = get();
    if (dailyGiftLeft(s.dailyGift) <= 0) return;
    const today = todayKey();
    const claimed = s.dailyGift.date === today ? s.dailyGift.claimed : 0;
    set({
      sparks: s.sparks + DAILY_GIFT_SPARKS,
      dailyGift: { date: today, claimed: claimed + 1 },
    });
  },

  armTrialUpgrade: (id) => {
    const def = UPGRADE_CATALOG.find((u) => u.id === id);
    if (!def) return;
    const level = get().upgrades[id] ?? 0;
    if (level >= def.maxLevel) return;
    set({ trialUpgrade: id });
  },

  buyHeadStart: () => {
    const s = get();
    if (s.headStartArmed || s.sparks < HEAD_START_COST) return;
    set({ sparks: s.sparks - HEAD_START_COST, headStartArmed: true });
  },
}));
