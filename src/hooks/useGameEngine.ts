import { useEffect, type RefObject } from 'react';
import { engine } from '../lib/engine/engine';
import { audio } from '../lib/engine/audio';
import { haptics } from '../lib/haptics';
import { useGameStore } from '../store/gameStore';

/**
 * Mounts the imperative engine onto the canvas, wires its callbacks to the
 * Zustand store, and keeps canvas size + mute state in sync.
 */
export function useGameEngine(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  onChainBreak: () => void,
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    engine.init(canvas, {
      onSync: (snap) => useGameStore.getState().syncFromEngine(snap),
      onRoundEnd: (stats) => useGameStore.getState().finishRound(stats),
      onCollapse: (stats) => useGameStore.getState().offerRevive(stats),
      onBoostOffer: (options) => useGameStore.getState().offerBoosts(options),
      onChainBreak,
    });

    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      engine.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the synth in sync with the persisted mute flag.
  const muted = useGameStore((s) => s.muted);
  useEffect(() => {
    audio.setMuted(muted);
  }, [muted]);

  // Same for vibration feedback.
  const hapticsOn = useGameStore((s) => s.haptics);
  useEffect(() => {
    haptics.setEnabled(hapticsOn);
  }, [hapticsOn]);
}
