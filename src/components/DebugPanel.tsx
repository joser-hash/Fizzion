import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '../lib/constants';
import { engine } from '../lib/engine/engine';

interface Field {
  key: keyof typeof CONFIG;
  label: string;
  min: number;
  max: number;
  step: number;
}

const FIELDS: Field[] = [
  { key: 'portalTime', label: 'Portal time (s)', min: 3, max: 30, step: 1 },
  { key: 'maxParticles', label: 'Max particles', min: 10, max: 120, step: 5 },
  { key: 'overloadMass', label: 'Overload mass', min: 10, max: 50, step: 1 },
  { key: 'friction', label: 'Friction', min: 0.9, max: 0.999, step: 0.001 },
  { key: 'swipeForce', label: 'Swipe force', min: 1, max: 20, step: 0.5 },
  { key: 'interstitialEveryNRounds', label: 'Interstitial every N', min: 1, max: 10, step: 1 },
  { key: 'rampDuration', label: 'Ramp duration (s)', min: 60, max: 420, step: 15 },
  { key: 'stabilityDrainExpire', label: 'Drain: expiry', min: 0.05, max: 0.4, step: 0.01 },
  { key: 'stabilityDrainOverload', label: 'Drain: overload', min: 0, max: 0.3, step: 0.01 },
];

/**
 * Hidden debug overlay: triple-tap the top-left corner or press D.
 * Sliders mutate the live CONFIG object; the engine reads it every frame.
 */
export function DebugPanel() {
  const [open, setOpen] = useState(false);
  const [, forceRender] = useState(0);
  const taps = useRef<number[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'd') setOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Live fps/tier readout while the panel is open.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => forceRender((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [open]);

  const onCornerTap = () => {
    const now = performance.now();
    taps.current = [...taps.current.filter((t) => now - t < 700), now];
    if (taps.current.length >= 3) {
      taps.current = [];
      setOpen((o) => !o);
    }
  };

  return (
    <>
      <div
        className="absolute left-0 top-0 z-40 h-16 w-16"
        onPointerDown={onCornerTap}
      />
      {open && (
        <div className="absolute left-2 top-16 z-40 w-64 rounded border border-white/20 bg-black/90 p-3 font-mono text-[11px] text-white/80">
          <div className="mb-2 flex justify-between">
            <span className="font-bold">DEBUG</span>
            <button onClick={() => setOpen(false)}>[x]</button>
          </div>
          <div className="mb-2 flex items-center justify-between">
            <span>{Math.round(engine.hud.fps)} fps</span>
            <span className="flex items-center gap-1">
              quality
              {[0, 1, 2].map((tier) => (
                <button
                  key={tier}
                  className={`px-1 ${
                    engine.quality === tier && engine.qualityLocked
                      ? 'bg-white/30 text-white'
                      : engine.quality === tier
                        ? 'bg-white/10 text-white'
                        : 'text-white/50'
                  }`}
                  onClick={() => engine.setQuality(tier, true)}
                >
                  {tier}
                </button>
              ))}
              <button
                className={`px-1 ${engine.qualityLocked ? 'text-white/50' : 'bg-white/10 text-white'}`}
                onClick={() => engine.setQuality(engine.quality, false)}
              >
                auto
              </button>
            </span>
          </div>
          {FIELDS.map((f) => (
            <label key={f.key} className="mb-2 block">
              <div className="flex justify-between">
                <span>{f.label}</span>
                <span>{String(CONFIG[f.key])}</span>
              </div>
              <input
                type="range"
                className="w-full"
                min={f.min}
                max={f.max}
                step={f.step}
                value={CONFIG[f.key] as number}
                onChange={(e) => {
                  (CONFIG as unknown as Record<string, number>)[f.key] = Number(e.target.value);
                  forceRender((n) => n + 1);
                }}
              />
            </label>
          ))}
        </div>
      )}
    </>
  );
}
