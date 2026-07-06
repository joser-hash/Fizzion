import { AnimatePresence } from 'framer-motion';
import { GameCanvas } from './components/GameCanvas';
import { HUD } from './components/HUD';
import { FtueCoach, RequestCoach } from './components/FtueCoach';
import { StartScreen } from './components/StartScreen';
import { ResultsScreen } from './components/ResultsScreen';
import { ReviveModal } from './components/ReviveModal';
import { AdModal } from './components/AdModal';
import { RotateOverlay } from './components/RotateOverlay';
import { DebugPanel } from './components/DebugPanel';
import { usePersistence } from './hooks/usePersistence';
import { useGameStore } from './store/gameStore';

export default function App() {
  usePersistence();
  const phase = useGameStore((s) => s.phase);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <GameCanvas />
      {phase === 'playing' && <HUD />}
      <FtueCoach />
      <RequestCoach />
      <AnimatePresence>
        {phase === 'menu' && <StartScreen key="start" />}
        {phase === 'revive' && <ReviveModal key="revive" />}
        {phase === 'results' && <ResultsScreen key="results" />}
      </AnimatePresence>
      <AdModal />
      <DebugPanel />
      <RotateOverlay />
    </div>
  );
}
