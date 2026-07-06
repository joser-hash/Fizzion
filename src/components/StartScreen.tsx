import { useState } from 'react';
import { motion } from 'framer-motion';
import { engine } from '../lib/engine/engine';
import { audio } from '../lib/engine/audio';
import { useGameStore } from '../store/gameStore';
import { SettingsButton, SettingsModal } from './SettingsModal';

export function startRound(): void {
  audio.unlock();
  useGameStore.getState().beginRound();
  engine.startRound();
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
      <motion.h1
        className="text-6xl font-black tracking-[0.2em] text-white"
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
        <div className="text-sm tracking-widest text-white/40">BEST {bestScore}</div>
      )}
      <motion.div
        className="text-lg font-semibold tracking-[0.3em] text-white/70"
        animate={{ opacity: [0.35, 1, 0.35] }}
        transition={{ duration: 1.6, repeat: Infinity }}
      >
        TAP TO PLAY
      </motion.div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </motion.div>
  );
}
