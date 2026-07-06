import { useRef } from 'react';
import { useGameEngine } from '../hooks/useGameEngine';
import { useGameStore } from '../store/gameStore';

/**
 * The single canvas the whole simulation renders into. Everything inside
 * it is imperative — React only mounts it and hands it to the engine.
 */
export function GameCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useGameEngine(ref, () => useGameStore.getState().notifyChainBreak());
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}
