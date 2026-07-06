import { useEffect } from 'react';
import { savePersisted, useGameStore } from '../store/gameStore';

/**
 * Debounced auto-save of the persistent slice (Sparks, bests, rounds
 * played, mute) to localStorage. Loading happens synchronously at store
 * creation, so this hook only handles writes.
 */
export function usePersistence(debounceMs = 400): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useGameStore.subscribe((s, prev) => {
      if (
        s.sparks === prev.sparks &&
        s.bestScore === prev.bestScore &&
        s.bestChain === prev.bestChain &&
        s.roundsPlayed === prev.roundsPlayed &&
        s.muted === prev.muted &&
        s.haptics === prev.haptics &&
        s.music === prev.music &&
        s.upgrades === prev.upgrades &&
        s.adsRemoved === prev.adsRemoved &&
        s.ftueDone === prev.ftueDone &&
        s.requestsTaught === prev.requestsTaught
      ) {
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const cur = useGameStore.getState();
        savePersisted({
          sparks: cur.sparks,
          bestScore: cur.bestScore,
          bestChain: cur.bestChain,
          roundsPlayed: cur.roundsPlayed,
          muted: cur.muted,
          haptics: cur.haptics,
          music: cur.music,
          upgrades: cur.upgrades,
          adsRemoved: cur.adsRemoved,
          ftueDone: cur.ftueDone,
          requestsTaught: cur.requestsTaught,
        });
      }, debounceMs);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [debounceMs]);
}
