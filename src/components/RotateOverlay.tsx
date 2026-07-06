import { useEffect, useState } from 'react';

function isLandscape(): boolean {
  return window.innerWidth > window.innerHeight;
}

/** Portrait-only: blocks the game with a prompt when landscape is detected. */
export function RotateOverlay() {
  const [landscape, setLandscape] = useState(isLandscape);

  useEffect(() => {
    const check = () => setLandscape(isLandscape());
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);

  if (!landscape) return null;

  return (
    <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-black">
      <div className="animate-pulse text-5xl">&#8635;</div>
      <div className="text-lg font-semibold tracking-wide text-white/80">
        Rotate your device
      </div>
      <div className="text-sm text-white/40">Fizzion is played in portrait.</div>
    </div>
  );
}
