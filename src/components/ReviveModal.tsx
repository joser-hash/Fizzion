import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { engine } from '../lib/engine/engine';
import { CONFIG } from '../lib/constants';
import { useAdService } from '../hooks/useAdService';
import { useGameStore } from '../store/gameStore';

/**
 * Second Chance offer: shown once per run when stability hits zero. Watching
 * a rewarded ad restores the portal and resumes the run; declining (or
 * letting the countdown lapse) ends the run for real.
 */
export function ReviveModal() {
  const acceptRevive = useGameStore((s) => s.acceptRevive);
  const { watchRewarded } = useAdService();
  const [secondsLeft, setSecondsLeft] = useState(CONFIG.reviveOfferSeconds);
  const [watching, setWatching] = useState(false);
  const decided = useRef(false);

  const decline = () => {
    if (decided.current) return;
    decided.current = true;
    // Emits onRoundEnd, which lands in finishRound -> results screen.
    engine.abandonRevive();
  };

  const accept = async () => {
    if (decided.current || watching) return;
    setWatching(true); // freeze the countdown while the ad plays
    const result = await watchRewarded('second_wind');
    if (result === 'completed') {
      decided.current = true;
      engine.revive();
      acceptRevive();
    } else {
      setWatching(false);
      decline(); // skipped the ad: no reward
    }
  };

  useEffect(() => {
    if (watching) return;
    if (secondsLeft <= 0) {
      decline();
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, watching]);

  return (
    <motion.div
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-8 bg-black/75 px-8 safe-top safe-bottom"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="flex flex-col items-center gap-2">
        <motion.div
          className="font-display text-xl font-black tracking-[0.3em] text-[#ff2975] [text-shadow:0_0_18px_rgba(255,41,117,0.6)]"
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 0.9, repeat: Infinity }}
        >
          PORTAL COLLAPSING
        </motion.div>
        <div className="text-xs tracking-[0.2em] text-white/50">ONE CHANCE TO SAVE IT</div>
      </div>

      <div className="relative flex h-20 w-20 items-center justify-center">
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="34" fill="none" stroke="#ffffff18" strokeWidth="4" />
          <motion.circle
            cx="40"
            cy="40"
            r="34"
            fill="none"
            stroke="#ff2975"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 34}
            animate={{
              strokeDashoffset: 2 * Math.PI * 34 * (1 - secondsLeft / CONFIG.reviveOfferSeconds),
            }}
            transition={{ duration: 1, ease: 'linear' }}
          />
        </svg>
        <div className="text-3xl font-black tabular-nums text-white">{secondsLeft}</div>
      </div>

      <div className="flex flex-col items-center gap-4">
        <motion.button
          className="rounded-full bg-[#00ff88] px-10 py-4 text-lg font-black tracking-wider text-black shadow-[0_0_30px_rgba(0,255,136,0.5)] active:scale-95 disabled:opacity-50"
          initial={{ scale: 0.9 }}
          animate={{ scale: [1, 1.04, 1] }}
          transition={{ duration: 1.2, repeat: Infinity }}
          onClick={accept}
          disabled={watching}
        >
          &#9654; SECOND CHANCE
        </motion.button>
        <div className="text-xs uppercase tracking-wider text-white/40">
          Watch an ad — portal restored to 50%
        </div>
        <button
          className="mt-2 text-xs uppercase tracking-wider text-white/30 underline"
          onClick={decline}
        >
          Give up
        </button>
      </div>
    </motion.div>
  );
}
