import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { BOOST_CATALOG, type BoostRarity } from '../lib/boosts';
import { GAME_ICONS } from './GameIcons';
import { audio } from '../lib/engine/audio';
import { haptics } from '../lib/haptics';
import { useAdService } from '../hooks/useAdService';
import { useGameStore } from '../store/gameStore';

const RARITY_STYLE: Record<
  BoostRarity,
  { label: string; border: string; text: string; glow: string }
> = {
  common: {
    label: 'COMMON',
    border: 'border-white/40',
    text: 'text-white/60',
    glow: 'shadow-[0_0_18px_rgba(255,255,255,0.12)]',
  },
  rare: {
    label: 'RARE',
    border: 'border-[#ffd500]/70',
    text: 'text-[#ffd500]',
    glow: 'shadow-[0_0_22px_rgba(255,213,0,0.25)]',
  },
  epic: {
    label: 'EPIC',
    border: 'border-[#ff2975]/80',
    text: 'text-[#ff2975]',
    glow: 'shadow-[0_0_26px_rgba(255,41,117,0.35)]',
  },
};

/** Header-only announce window before the cards slide in (ms). The title
 *  slam fills it: oversized punch-in, impact flash + shake, then settle. */
const ANNOUNCE_MS = 800;
/** Taps land only after this — a swipe in progress when the modal appears
 *  (the player is steering the orb right up to the freeze) can't misfire
 *  into a pick. */
const ARM_MS = 1100;
/** Pick-and-scatter exit: the chosen card pops and flies off, the others
 *  drop away, then the engine resumes (it stays frozen until this elapses). */
const EXIT_MS = 480;

/**
 * Mid-run boost pick: the engine is frozen underneath, so the choice is
 * forced — no dismiss. One rewarded-ad reroll per offer.
 */
export function BoostPickModal() {
  const offer = useGameStore((s) => s.boostOffer);
  const chooseBoost = useGameStore((s) => s.chooseBoost);
  const rerollBoosts = useGameStore((s) => s.rerollBoosts);
  const { watchRewarded } = useAdService();
  const [rerolled, setRerolled] = useState(false);
  const [watching, setWatching] = useState(false);
  const [armed, setArmed] = useState(false);
  /** Card id mid-exit-animation; the actual pick lands when it finishes. */
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (!offer) return;
    const t = setTimeout(() => setArmed(true), ARM_MS);
    return () => clearTimeout(t);
  }, [offer]);

  // Slam impact beat, once per offer freeze (rerolls don't remount).
  useEffect(() => {
    audio.surge();
    haptics.heavy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!offer) return null;
  const cards = offer
    .map((id) => BOOST_CATALOG.find((b) => b.id === id))
    .filter((b) => b !== undefined);

  const pick = (id: string) => {
    if (picked) return;
    setPicked(id);
    haptics.tap();
    // chooseBoost unfreezes the engine, so hold it until the exit lands.
    setTimeout(() => chooseBoost(id), EXIT_MS);
  };

  const reroll = async () => {
    if (rerolled || watching || picked) return;
    setWatching(true);
    const result = await watchRewarded('boost_reroll');
    setWatching(false);
    if (result === 'completed') {
      setRerolled(true);
      rerollBoosts();
    }
  };

  return (
    <motion.div
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-black/75 px-6 safe-top safe-bottom"
      style={{ pointerEvents: armed && !picked ? 'auto' : 'none' }}
      initial={{ opacity: 0 }}
      animate={{
        opacity: 1,
        // Impact shake: kicks in right as the title spring lands.
        x: [0, 0, -7, 6, -4, 2, 0],
      }}
      transition={{
        opacity: { duration: 0.15 },
        x: { delay: 0.16, duration: 0.32, ease: 'easeOut' },
      }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
    >
      {/* Impact flash, timed to the slam landing. */}
      <motion.div
        className="pointer-events-none absolute inset-0 bg-[#00e5ff]"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.22, 0] }}
        transition={{ delay: 0.13, duration: 0.45, times: [0, 0.3, 1] }}
      />

      <motion.div
        className="flex flex-col items-center gap-1"
        animate={picked ? { opacity: 0, scale: 0.92 } : { opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        {/* Title slams in oversized and settles with a spring overshoot. */}
        <motion.div
          className="font-display text-xl font-black tracking-[0.3em] text-[#00e5ff] [text-shadow:0_0_18px_rgba(0,229,255,0.6)]"
          initial={{ scale: 2.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 460, damping: 15, mass: 0.9 }}
        >
          <motion.span
            className="block"
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 1.4, repeat: Infinity, delay: 0.6 }}
          >
            POWER SURGE
          </motion.span>
        </motion.div>
        <motion.div
          className="text-xs tracking-[0.2em] text-white/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45 }}
        >
          CHOOSE A BOOST
        </motion.div>
      </motion.div>

      <div className="flex w-full max-w-sm flex-col gap-3">
        {cards.map((b, i) => {
          const style = RARITY_STYLE[b.rarity];
          const Icon = GAME_ICONS[b.id];
          const isPicked = picked === b.id;
          return (
            <motion.button
              key={b.id}
              className={`flex items-center gap-4 rounded-2xl border-2 ${style.border} ${style.glow} bg-black/60 px-5 py-4 text-left active:scale-[0.97] ${picked ? '' : 'disabled:opacity-50'}`}
              initial={{ opacity: 0, y: 24 }}
              animate={
                picked
                  ? isPicked
                    ? // Chosen: pop bright, then shrink away into the run.
                      { opacity: [1, 1, 0], scale: [1, 1.12, 0.15], y: 0 }
                    : // Unpicked: drop out of frame.
                      { opacity: 0, y: 44, scale: 1 }
                  : { opacity: armed ? 1 : 0.55, y: 0, scale: 1 }
              }
              transition={
                picked
                  ? isPicked
                    ? { duration: EXIT_MS / 1000, times: [0, 0.35, 1], ease: 'easeIn' }
                    : { duration: 0.22, ease: 'easeIn' }
                  : { delay: armed ? 0 : ANNOUNCE_MS / 1000 + i * 0.1 }
              }
              onClick={() => pick(b.id)}
              disabled={watching || !armed || picked !== null}
            >
              {Icon && (
                <span className={`shrink-0 ${style.text}`}>
                  <Icon size={28} />
                </span>
              )}
              <span className="flex flex-col">
                <span className={`text-[10px] font-bold tracking-[0.25em] ${style.text}`}>
                  {style.label}
                </span>
                <span className="font-display text-base font-black tracking-wider text-white">
                  {b.name.toUpperCase()}
                </span>
                <span className="mt-1 text-xs text-white/60">{b.desc}</span>
              </span>
            </motion.button>
          );
        })}
      </div>

      {!rerolled && (
        <motion.button
          className={`rounded-full border border-white/25 px-6 py-2 text-xs font-bold uppercase tracking-[0.2em] text-white/60 active:scale-95 ${picked ? '' : 'disabled:opacity-50'}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: picked ? 0 : 1 }}
          transition={{
            delay: armed || picked ? 0 : ANNOUNCE_MS / 1000 + 0.4,
            duration: picked ? 0.2 : undefined,
          }}
          onClick={reroll}
          disabled={watching || !armed || picked !== null}
        >
          {watching ? 'Loading…' : '▶ Reroll (ad)'}
        </motion.button>
      )}
    </motion.div>
  );
}
