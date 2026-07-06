import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../store/gameStore';

export function GearIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.6 3.5c0-.6-.06-1.17-.17-1.73l2.02-1.58-2.05-3.55-2.38.96a8.6 8.6 0 0 0-3-1.73L14.66 2h-4.1l-.53 2.6a8.6 8.6 0 0 0-3 1.73l-2.38-.96L2.6 8.92l2.02 1.58a8.7 8.7 0 0 0 0 3.46L2.6 15.54l2.05 3.55 2.38-.96a8.6 8.6 0 0 0 3 1.73l.53 2.6h4.1l.53-2.6a8.6 8.6 0 0 0 3-1.73l2.38.96 2.05-3.55-2.02-1.58c.11-.56.17-1.13.17-1.73Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Small round gear button, absolutely positioned by the parent. */
export function SettingsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      className="pointer-events-auto rounded-full border border-white/20 bg-black/50 p-2.5 text-white/60 active:scale-95"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      // The start screen starts a round on pointerup anywhere; keep the
      // gear from triggering it.
      onPointerUp={(e) => e.stopPropagation()}
      aria-label="Settings"
    >
      <GearIcon />
    </button>
  );
}

function Toggle({ on, onFlip }: { on: boolean; onFlip: () => void }) {
  return (
    <button
      className={`relative h-7 w-12 rounded-full border transition-colors ${
        on ? 'border-[#00ff88]/70 bg-[#00ff88]/25' : 'border-white/20 bg-white/5'
      }`}
      onClick={onFlip}
      role="switch"
      aria-checked={on}
    >
      <motion.span
        className={`absolute top-0.5 h-5.5 w-5.5 rounded-full ${
          on ? 'bg-[#00ff88] shadow-[0_0_10px_rgba(0,255,136,0.7)]' : 'bg-white/40'
        }`}
        animate={{ left: on ? 24 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      />
    </button>
  );
}

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const muted = useGameStore((s) => s.muted);
  const hapticsOn = useGameStore((s) => s.haptics);
  const musicOn = useGameStore((s) => s.music);
  const toggleMute = useGameStore((s) => s.toggleMute);
  const toggleHaptics = useGameStore((s) => s.toggleHaptics);
  const toggleMusic = useGameStore((s) => s.toggleMusic);
  const [confirmReset, setConfirmReset] = useState(false);

  const reset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    try {
      localStorage.removeItem('fizzion_save');
    } catch {
      // Storage unavailable — reload still gives a clean session.
    }
    window.location.reload();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/85 px-5 safe-top safe-bottom"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => {
            setConfirmReset(false);
            onClose();
          }}
        >
          <motion.div
            className="w-full max-w-sm rounded-2xl border border-white/15 bg-black p-5"
            initial={{ scale: 0.92, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: 16 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-display mb-5 text-lg font-black tracking-[0.25em] text-white">SETTINGS</div>

            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white/80">Sound effects</span>
                <Toggle on={!muted} onFlip={toggleMute} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white/80">Music</span>
                <Toggle on={musicOn} onFlip={toggleMusic} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white/80">Haptics</span>
                <Toggle on={hapticsOn} onFlip={toggleHaptics} />
              </div>
            </div>

            <div className="my-5 h-px bg-white/10" />

            <a
              className="block text-center text-xs font-semibold uppercase tracking-wider text-[#00cfff]/90 underline underline-offset-4"
              href="https://infinitygames.io/privacy-policy/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Privacy Policy
            </a>

            <button
              className={`mt-5 w-full rounded-full border py-2.5 text-xs font-bold tracking-widest ${
                confirmReset
                  ? 'border-[#ff2975] bg-[#ff2975]/15 text-[#ff2975]'
                  : 'border-white/20 text-white/50'
              }`}
              onClick={reset}
            >
              {confirmReset ? 'TAP AGAIN TO CONFIRM' : 'RESET GAME DATA'}
            </button>

            <button
              className="mt-3 w-full rounded-full border border-white/25 py-2.5 text-sm font-bold tracking-widest text-white/80"
              onClick={() => {
                setConfirmReset(false);
                onClose();
              }}
            >
              CLOSE
            </button>

            <div className="mt-4 text-center text-[10px] tracking-[0.25em] text-white/25">
              FIZZION v{__APP_VERSION__}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
