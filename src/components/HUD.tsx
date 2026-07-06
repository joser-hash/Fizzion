import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { engine } from '../lib/engine/engine';
import { CONFIG } from '../lib/constants';
import { useGameStore } from '../store/gameStore';
import { useAdService } from '../hooks/useAdService';
import { SparkIcon } from './SparkIcon';
import { SettingsButton, SettingsModal } from './SettingsModal';

/** Score digits update per-frame from the engine ref — no React re-render churn. */
function Score() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (ref.current) {
        ref.current.textContent = String(Math.round(engine.hud.displayScore));
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      ref={ref}
      className="text-3xl font-bold tabular-nums text-white [text-shadow:0_0_12px_rgba(255,255,255,0.5)]"
    >
      0
    </div>
  );
}

function Chain() {
  const chain = useGameStore((s) => s.chain);
  const heat = Math.min(1, useGameStore((s) => s.comboHeat) / CONFIG.comboHeatFull);
  // Blink as the chain window runs out so the break never feels random.
  const expiring = useGameStore((s) => s.chainTimeLeft) < CONFIG.chainWarnAt;
  const nonce = useGameStore((s) => s.chainBreakNonce);
  const [shatter, setShatter] = useState<{ id: number; text: string } | null>(null);
  const prevChain = useRef(0);
  const prevNonce = useRef(nonce);

  useEffect(() => {
    if (nonce !== prevNonce.current) {
      prevNonce.current = nonce;
      if (prevChain.current > 0) {
        setShatter({ id: nonce, text: `CHAIN x${prevChain.current}` });
        const t = setTimeout(() => setShatter(null), 800);
        return () => clearTimeout(t);
      }
    }
  }, [nonce]);

  useEffect(() => {
    prevChain.current = chain;
  }, [chain]);

  return (
    <div className="relative h-6">
      <AnimatePresence>
        {chain > 0 && !shatter && (
          <motion.div
            key={`chain-${chain}`}
            initial={{ scale: 1.6 + heat * 0.4, opacity: 0 }}
            animate={{
              scale: 1 + heat * 0.35,
              opacity: expiring ? [1, 0.25, 1] : 1,
            }}
            transition={
              expiring ? { opacity: { duration: 0.5, repeat: Infinity } } : undefined
            }
            style={{
              transformOrigin: 'left center',
              textShadow: `0 0 ${10 + heat * 18}px rgba(255,213,0,${0.6 + heat * 0.4})`,
            }}
            className="text-sm font-bold tracking-widest text-[#ffd500]"
          >
            CHAIN x{chain}
          </motion.div>
        )}
      </AnimatePresence>
      {shatter && (
        <div className="absolute left-0 top-0 flex">
          {shatter.text.split('').map((ch, i) => (
            <motion.span
              key={`${shatter.id}-${i}`}
              className="text-sm font-bold text-[#ffd500]"
              initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
              animate={{
                x: (Math.random() - 0.5) * 90,
                y: 30 + Math.random() * 50,
                opacity: 0,
                rotate: (Math.random() - 0.5) * 180,
              }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
            >
              {ch === ' ' ? '\u00A0' : ch}
            </motion.span>
          ))}
        </div>
      )}
    </div>
  );
}

export function formatRunTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Elapsed run time — subtle; urgency lives in the stability bar on canvas. */
function Timer() {
  const runTime = useGameStore((s) => s.runTime);
  return (
    <div className="text-xl font-semibold tabular-nums text-white/40">
      {formatRunTime(runTime)}
    </div>
  );
}

function StabilizeButton() {
  const instability = useGameStore((s) => s.instability);
  const { watchRewarded } = useAdService();
  const [busy, setBusy] = useState(false);

  if (instability < CONFIG.stabilizeOfferThreshold || busy) return null;

  const onClick = async () => {
    setBusy(true);
    engine.setPaused(true);
    const result = await watchRewarded('stabilize');
    if (result === 'completed') engine.applyStabilize();
    engine.setPaused(false);
    setBusy(false);
  };

  return (
    <motion.button
      className="pointer-events-auto rounded-full border border-[#00cfff]/70 bg-black/60 px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#00cfff] shadow-[0_0_16px_rgba(0,207,255,0.45)]"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0, scale: [1, 1.08, 1] }}
      exit={{ opacity: 0 }}
      transition={{ scale: { duration: 0.9, repeat: Infinity } }}
      onClick={onClick}
    >
      &#9654; Stabilize
    </motion.button>
  );
}

function ColorLockButton() {
  const charges = useGameStore((s) => s.colorLockCharges);
  const lockLeft = useGameStore((s) => s.colorLockLeft);
  const useCharge = useGameStore((s) => s.useColorLockCharge);

  if (lockLeft > 0) {
    return (
      <div className="rounded-full border border-white/40 bg-black/60 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white/80">
        Locked {Math.ceil(lockLeft)}s
      </div>
    );
  }
  if (charges <= 0) return null;

  return (
    <motion.button
      className="pointer-events-auto rounded-full border border-white/50 bg-black/60 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white shadow-[0_0_14px_rgba(255,255,255,0.3)]"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => {
        engine.activateColorLock();
        useCharge();
      }}
    >
      Color Lock ({charges})
    </motion.button>
  );
}

// Session-scoped: teach the stability mechanic exactly once.
let stabilityHintShown = false;

/**
 * Damage teach hint: fires on the first actual damage moment (stability
 * drop) and sits right under the bar it explains. Steering/eating/delivery
 * onboarding lives in the first-run FtueCoach.
 */
function DamageHint() {
  const stability = useGameStore((s) => s.stability);
  const phase = useGameStore((s) => s.phase);
  const [visible, setVisible] = useState(false);
  const prevStability = useRef(1);

  useEffect(() => {
    const prev = prevStability.current;
    prevStability.current = stability;
    // First real damage tick of the session: teach while the red ghost fades.
    if (!stabilityHintShown && phase === 'playing' && stability > 0 && stability < prev - 0.01) {
      stabilityHintShown = true;
      setVisible(true);
      const t = setTimeout(() => setVisible(false), 4000);
      return () => clearTimeout(t);
    }
  }, [stability, phase]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="absolute inset-x-0 top-6 whitespace-nowrap text-center text-xs leading-tight tracking-wide text-[#ff2975] [text-shadow:0_0_10px_rgba(255,41,117,0.5)]"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 1 } }}
        >
          &#9650; Missed requests damage the portal!
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function HUD() {
  const sparks = useGameStore((s) => s.sparks);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const openSettings = () => {
    engine.setPaused(true);
    setSettingsOpen(true);
  };
  const closeSettings = () => {
    setSettingsOpen(false);
    engine.setPaused(false);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 safe-top safe-bottom safe-x">
      <div className="flex items-start justify-between px-4 pt-4">
        <div>
          <Score />
          <Chain />
        </div>
        <Timer />
      </div>

      <DamageHint />

      <div className="absolute inset-x-0 bottom-24 flex justify-center gap-3">
        <StabilizeButton />
        <ColorLockButton />
      </div>

      <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between px-4 pb-3">
        <div className="flex items-center gap-1.5 text-lg font-bold text-[#ffd500]/90 [text-shadow:0_0_10px_rgba(255,213,0,0.4)]">
          <SparkIcon size={18} /> {sparks}
        </div>
        <SettingsButton onOpen={openSettings} />
      </div>

      <div className="pointer-events-auto">
        <SettingsModal open={settingsOpen} onClose={closeSettings} />
      </div>
    </div>
  );
}
