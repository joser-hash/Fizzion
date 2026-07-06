import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { audio } from '../lib/engine/audio';
import { useAdService } from '../hooks/useAdService';
import { useGameStore } from '../store/gameStore';
import { startRound } from './StartScreen';
import { formatRunTime } from './HUD';
import { ShopModal } from './ShopModal';
import { SettingsButton, SettingsModal } from './SettingsModal';
import { SparkIcon } from './SparkIcon';

/** Final score counts up smoothly with an audible tick. */
function CountUpScore({ target }: { target: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let shown = 0;
    let lastTick = 0;
    const start = performance.now();
    const dur = Math.min(2000, 600 + target * 2);
    const step = (now: number) => {
      const t = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = Math.round(target * eased);
      if (val !== shown) {
        shown = val;
        if (ref.current) ref.current.textContent = String(val);
        if (now - lastTick > 40) {
          lastTick = now;
          audio.tick();
        }
      }
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return (
    <div
      ref={ref}
      className="text-6xl font-black tabular-nums text-white [text-shadow:0_0_24px_rgba(255,255,255,0.55)]"
    >
      0
    </div>
  );
}

export function ResultsScreen() {
  const lastRound = useGameStore((s) => s.lastRound);
  const sparks = useGameStore((s) => s.sparks);
  const ftueDone = useGameStore((s) => s.ftueDone);
  const completeFtue = useGameStore((s) => s.completeFtue);
  const bestScore = useGameStore((s) => s.bestScore);
  const sessionBest = useGameStore((s) => s.sessionBest);
  const colorLockCharges = useGameStore((s) => s.colorLockCharges);
  const doubleDown = useGameStore((s) => s.doubleDown);
  const addColorLockCharge = useGameStore((s) => s.addColorLockCharge);
  const { watchRewarded, maybeShowInterstitial } = useAdService();
  const [starting, setStarting] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!lastRound) return null;

  const sparksShown = lastRound.doubled
    ? lastRound.sparksEarned * 2
    : lastRound.sparksEarned;

  const onPlayAgain = async () => {
    if (starting) return;
    setStarting(true);
    if (!ftueDone) completeFtue(); // full loop seen: coach retires
    await maybeShowInterstitial();
    startRound();
  };

  const onOpenShop = () => {
    if (!ftueDone) completeFtue();
    setShopOpen(true);
  };

  const onDoubleDown = async () => {
    const r = await watchRewarded('double_down');
    if (r === 'completed') doubleDown();
  };

  const onColorLock = async () => {
    const r = await watchRewarded('color_lock');
    if (r === 'completed') addColorLockCharge();
  };

  const item = (i: number) => ({
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: 0.15 + i * 0.12 },
  });

  return (
    <motion.div
      className="absolute inset-0 z-20 flex flex-col items-center justify-between bg-black/70 safe-top safe-bottom"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute right-4 top-4 safe-top">
        <SettingsButton onOpen={() => setSettingsOpen(true)} />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6">
        <motion.div {...item(0)} className="flex flex-col items-center gap-1">
          <div className="text-lg font-bold tracking-[0.3em] text-[#ff2975] [text-shadow:0_0_16px_rgba(255,41,117,0.5)]">
            PORTAL COLLAPSED
          </div>
          <div className="text-xs tracking-[0.3em] text-white/40">
            SURVIVED {formatRunTime(lastRound.duration)}
          </div>
        </motion.div>

        <motion.div {...item(1)} className="flex flex-col items-center gap-1">
          <CountUpScore target={lastRound.score} />
          {lastRound.newBestScore && (
            <motion.div
              className="text-sm font-bold tracking-widest text-[#00ff88] [text-shadow:0_0_12px_rgba(0,255,136,0.6)]"
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            >
              NEW BEST!
            </motion.div>
          )}
        </motion.div>

        <motion.div {...item(2)} className="flex gap-8 text-center">
          <div>
            <div className="text-xl font-bold text-[#ffd500]">x{lastRound.bestChain || 1}</div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">Best chain</div>
          </div>
          <motion.div
            animate={
              !ftueDone
                ? { scale: [1, 1.12, 1], filter: ['brightness(1)', 'brightness(1.5)', 'brightness(1)'] }
                : undefined
            }
            transition={{ duration: 1.4, repeat: Infinity }}
          >
            <div className="text-xl font-bold text-[#ffd500]">
              +{sparksShown} {lastRound.doubled && <span className="text-xs">(x2)</span>}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">Sparks</div>
          </motion.div>
          <div>
            <div className="text-xl font-bold text-white/80">{Math.max(bestScore, sessionBest)}</div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">All-time best</div>
          </div>
        </motion.div>

        <motion.div
          {...item(3)}
          className="flex items-center gap-1.5 text-sm text-[#ffd500]/80"
        >
          <SparkIcon size={14} /> Wallet: {sparks}
        </motion.div>

        <motion.div {...item(4)} className="flex flex-col items-center gap-3">
          {!lastRound.doubled && lastRound.sparksEarned > 0 && (
            <button
              className="rounded-full border border-[#ffd500]/60 px-6 py-2.5 text-sm font-bold uppercase tracking-wider text-[#ffd500] shadow-[0_0_16px_rgba(255,213,0,0.3)]"
              onClick={onDoubleDown}
            >
              &#9654; Double Down — 2x Sparks
            </button>
          )}
          {colorLockCharges === 0 && (
            <button
              className="rounded-full border border-[#00cfff]/50 px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-[#00cfff]/90 shadow-[0_0_14px_rgba(0,207,255,0.25)]"
              onClick={onColorLock}
            >
              &#9654; Color Lock — free 5s freeze next round
            </button>
          )}
        </motion.div>

        <motion.button
          {...item(5)}
          className="mt-2 rounded-full bg-white px-12 py-4 text-xl font-black tracking-widest text-black shadow-[0_0_30px_rgba(255,255,255,0.5)] active:scale-95"
          onClick={onPlayAgain}
          disabled={starting}
        >
          PLAY AGAIN
        </motion.button>

        {!ftueDone && (
          <motion.div
            {...item(6)}
            className="max-w-64 text-center text-xs leading-snug text-[#ffd500]/80"
          >
            Sparks are yours to keep — spend them in the shop on permanent upgrades for every
            next run.
          </motion.div>
        )}

        <motion.button
          className="flex items-center gap-2 rounded-full border border-[#ffd500]/60 px-6 py-2.5 text-xs font-bold uppercase tracking-[0.3em] text-[#ffd500]/90 shadow-[0_0_16px_rgba(255,213,0,0.25)]"
          initial={{ opacity: 0, y: 16 }}
          animate={
            !ftueDone
              ? { opacity: [0.8, 1, 0.8], scale: [1, 1.12, 1], y: 0 }
              : { opacity: 1, y: 0 }
          }
          transition={
            !ftueDone
              ? { delay: 0.99, duration: 1.4, repeat: Infinity }
              : { delay: 0.99 }
          }
          onClick={onOpenShop}
        >
          <SparkIcon size={14} /> Shop
        </motion.button>
      </div>

      <ShopModal open={shopOpen} onClose={() => setShopOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </motion.div>
  );
}
