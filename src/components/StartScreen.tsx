import { useState } from 'react';
import { motion } from 'framer-motion';
import { engine } from '../lib/engine/engine';
import { audio } from '../lib/engine/audio';
import { startMusic } from '../audio/useGameMusic';
import { useGameStore } from '../store/gameStore';
import { SettingsButton, SettingsModal } from './SettingsModal';

export function startRound(): void {
  audio.unlock();
  // User gesture: allowed to create/resume the AudioContext (no-op if the
  // music is already running or disabled in settings).
  if (useGameStore.getState().music) void startMusic();
  useGameStore.getState().beginRound();
  engine.startRound({ colorRamp: !useGameStore.getState().colorRampDone });
}

export function StartScreen() {
  const bestScore = useGameStore((s) => s.bestScore);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <motion.div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-8 safe-top safe-bottom"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerUp={settingsOpen ? undefined : startRound}
    >
      <div className="absolute bottom-3 right-4 safe-bottom">
        <SettingsButton onOpen={() => setSettingsOpen(true)} />
      </div>
      {/* pl matches the tracking: letter-spacing trails the last glyph, which
          otherwise shifts the visible text left of true center. */}
      <motion.h1
        className="font-display pl-[0.2em] text-5xl font-black tracking-[0.2em] text-white"
        style={{
          textShadow:
            '0 0 20px rgba(0,255,136,0.8), 0 0 60px rgba(0,207,255,0.5), 0 0 90px rgba(255,41,117,0.35)',
        }}
        animate={{ scale: [1, 1.04, 1] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      >
        FIZZION
      </motion.h1>
      {bestScore > 0 && (
        <div className="pl-[0.1em] text-sm tracking-widest text-white/40">BEST {bestScore}</div>
      )}
      <motion.div
        className="pl-[0.3em] text-lg font-semibold tracking-[0.3em] text-white/70"
        animate={{ opacity: [0.35, 1, 0.35] }}
        transition={{ duration: 1.6, repeat: Infinity }}
      >
        TAP TO PLAY
      </motion.div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </motion.div>
  );
}
