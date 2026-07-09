import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  DAILY_GIFT_MAX,
  DAILY_GIFT_SPARKS,
  HEAD_START_COST,
  IAP_CATALOG,
  UPGRADE_CATALOG,
} from '../lib/constants';
import { purchaseService } from '../lib/ads';
import { useAdService } from '../hooks/useAdService';
import { dailyGiftLeft, useGameStore } from '../store/gameStore';
import { SparkIcon } from './SparkIcon';
import { GAME_ICONS } from './GameIcons';

function LevelPips({ level, max }: { level: number; max: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-4 rounded-full ${
            i < level ? 'bg-[#00ff88] shadow-[0_0_6px_rgba(0,255,136,0.7)]' : 'bg-white/15'
          }`}
        />
      ))}
    </div>
  );
}

export function ShopModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sparks = useGameStore((s) => s.sparks);
  const upgrades = useGameStore((s) => s.upgrades);
  const adsRemoved = useGameStore((s) => s.adsRemoved);
  const dailyGift = useGameStore((s) => s.dailyGift);
  const trialUpgrade = useGameStore((s) => s.trialUpgrade);
  const headStartArmed = useGameStore((s) => s.headStartArmed);
  const buyUpgrade = useGameStore((s) => s.buyUpgrade);
  const completePurchase = useGameStore((s) => s.completePurchase);
  const claimDailyGift = useGameStore((s) => s.claimDailyGift);
  const armTrialUpgrade = useGameStore((s) => s.armTrialUpgrade);
  const buyHeadStart = useGameStore((s) => s.buyHeadStart);
  const { watchRewarded } = useAdService();
  const [buying, setBuying] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);

  const giftLeft = dailyGiftLeft(dailyGift);

  // Point-of-intent: highlight the Sparks packs when an upgrade is out of reach.
  const wantsSparks = UPGRADE_CATALOG.some((u) => {
    const level = upgrades[u.id] ?? 0;
    return level < u.maxLevel && sparks < u.costs[level];
  });

  const iapProducts = IAP_CATALOG.filter(
    (p) => (p.type === 'consumable' && p.sparks) || (p.id === 'remove_ads' && !adsRemoved),
  );

  const buyIap = async (productId: string) => {
    if (buying) return;
    setBuying(productId);
    const result = await purchaseService.purchase(productId);
    if (result.success) completePurchase(productId);
    setBuying(null);
  };

  const onDailyGift = async () => {
    if (watching || giftLeft <= 0) return;
    setWatching(true);
    const result = await watchRewarded('daily_gift');
    if (result === 'completed') claimDailyGift();
    setWatching(false);
  };

  const onTrial = async (id: string) => {
    if (watching) return;
    setWatching(true);
    const result = await watchRewarded('upgrade_trial');
    if (result === 'completed') armTrialUpgrade(id);
    setWatching(false);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/85 px-5 safe-top safe-bottom"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="max-h-[88%] w-full max-w-sm overflow-y-auto rounded-2xl border border-white/15 bg-black p-5"
            initial={{ scale: 0.92, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: 16 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="font-display text-lg font-black tracking-[0.25em] text-white">SHOP</div>
              <div className="flex items-center gap-1 text-sm font-semibold text-[#ffd500] [text-shadow:0_0_10px_rgba(255,213,0,0.4)]">
                <SparkIcon size={15} /> {sparks}
              </div>
            </div>

            {/* Daily Gift: a capped free-Sparks faucet behind a rewarded ad. */}
            <div
              className={`mb-4 rounded-xl border p-3 ${
                giftLeft > 0
                  ? 'border-[#ffd500]/40 bg-[#ffd500]/[0.06] shadow-[0_0_12px_rgba(255,213,0,0.15)]'
                  : 'border-white/10 bg-white/[0.04]'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-white">DAILY GIFT</div>
                  <div className="mt-0.5 text-xs text-white/45">
                    {giftLeft > 0 ? `${giftLeft}/${DAILY_GIFT_MAX} left today` : 'Back tomorrow'}
                  </div>
                </div>
                <button
                  className={`flex shrink-0 items-center gap-1 rounded-full border px-4 py-1.5 text-xs font-bold tracking-wider ${
                    giftLeft > 0
                      ? 'border-[#ffd500]/60 text-[#ffd500] shadow-[0_0_10px_rgba(255,213,0,0.25)] active:scale-95'
                      : 'border-white/15 text-white/25'
                  }`}
                  disabled={giftLeft <= 0 || watching}
                  onClick={onDailyGift}
                >
                  AD +{DAILY_GIFT_SPARKS} <SparkIcon size={12} />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {UPGRADE_CATALOG.map((u) => {
                const level = upgrades[u.id] ?? 0;
                const maxed = level >= u.maxLevel;
                const cost = maxed ? 0 : u.costs[level];
                const affordable = !maxed && sparks >= cost;
                const Icon = GAME_ICONS[u.id];
                return (
                  <div
                    key={u.id}
                    className="rounded-xl border border-white/10 bg-white/[0.04] p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-bold text-white">
                        {Icon && (
                          <span className="text-[#ffd500]">
                            <Icon size={20} />
                          </span>
                        )}
                        {u.name}
                      </div>
                      <LevelPips level={level} max={u.maxLevel} />
                    </div>
                    <div className="mt-1 text-xs leading-snug text-white/45">{u.desc}</div>
                    <div className="mt-2 flex items-center justify-end gap-2">
                      {maxed ? (
                        <span className="text-xs font-bold tracking-wider text-[#00ff88]">
                          MAX
                        </span>
                      ) : (
                        <>
                          {trialUpgrade === u.id ? (
                            <span className="text-[10px] font-bold tracking-wider text-[#00cfff] [text-shadow:0_0_8px_rgba(0,207,255,0.4)]">
                              TRIAL — NEXT RUN
                            </span>
                          ) : (
                            <button
                              className="rounded-full border border-[#00cfff]/40 px-3 py-1.5 text-[10px] font-bold tracking-wider text-[#00cfff] active:scale-95 disabled:opacity-40"
                              disabled={watching}
                              onClick={() => onTrial(u.id)}
                            >
                              TRY (AD)
                            </button>
                          )}
                          <button
                            className={`flex items-center gap-1 rounded-full border px-4 py-1.5 text-xs font-bold tracking-wider ${
                              affordable
                                ? 'border-[#ffd500]/60 text-[#ffd500] shadow-[0_0_10px_rgba(255,213,0,0.25)] active:scale-95'
                                : 'border-white/15 text-white/25'
                            }`}
                            disabled={!affordable}
                            onClick={() => buyUpgrade(u.id)}
                          >
                            <SparkIcon size={12} /> {cost}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Head Start: a repeatable Sparks sink queued for the next run. */}
            <div className="mt-4 text-[10px] font-bold uppercase tracking-[0.3em] text-white/35">
              Next Run
            </div>
            <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.04] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-white">HEAD START</div>
                  <div className="mt-1 text-xs leading-snug text-white/45">
                    Open your next run with a Power Surge boost pick
                  </div>
                </div>
                {headStartArmed ? (
                  <span className="shrink-0 text-[10px] font-bold tracking-wider text-[#00ff88]">
                    ARMED — NEXT RUN
                  </span>
                ) : (
                  <button
                    aria-label="Buy Head Start"
                    className={`flex shrink-0 items-center gap-1 rounded-full border px-4 py-1.5 text-xs font-bold tracking-wider ${
                      sparks >= HEAD_START_COST
                        ? 'border-[#ffd500]/60 text-[#ffd500] shadow-[0_0_10px_rgba(255,213,0,0.25)] active:scale-95'
                        : 'border-white/15 text-white/25'
                    }`}
                    disabled={sparks < HEAD_START_COST}
                    onClick={buyHeadStart}
                  >
                    <SparkIcon size={12} /> {HEAD_START_COST}
                  </button>
                )}
              </div>
            </div>

            <div
              className={`mt-4 text-[10px] font-bold uppercase tracking-[0.3em] ${
                wantsSparks ? 'text-[#ffd500]' : 'text-white/35'
              }`}
            >
              Get Sparks
            </div>
            <div className="mt-2 flex flex-col gap-2">
              {iapProducts.map((p) => (
                <button
                  key={p.id}
                  className={`flex items-center justify-between rounded-xl border p-3 text-left active:scale-[0.98] disabled:opacity-40 ${
                    wantsSparks && p.type === 'consumable'
                      ? 'border-[#ffd500]/40 bg-[#ffd500]/[0.06] shadow-[0_0_12px_rgba(255,213,0,0.15)]'
                      : 'border-white/10 bg-white/[0.04]'
                  }`}
                  disabled={buying !== null}
                  onClick={() => buyIap(p.id)}
                >
                  <span className="flex items-center gap-1.5 text-sm font-bold text-white">
                    {p.type === 'consumable' ? (
                      <>
                        <SparkIcon size={13} className="text-[#ffd500]" /> {p.title}
                      </>
                    ) : (
                      p.title
                    )}
                  </span>
                  <span className="text-xs font-bold tracking-wider text-[#00cfff]">
                    ${p.priceUsd.toFixed(2)}
                  </span>
                </button>
              ))}
            </div>

            <button
              className="mt-5 w-full rounded-full border border-white/25 py-2.5 text-sm font-bold tracking-widest text-white/80"
              onClick={onClose}
            >
              CLOSE
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
