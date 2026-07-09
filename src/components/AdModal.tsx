import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { mockAdController, type MockAdRequest } from '../lib/ads';
import { CONFIG } from '../lib/constants';

const PLACEMENT_LABELS: Record<string, string> = {
  stabilize: 'Stabilize',
  color_lock: 'Color Lock',
  double_down: 'Double Down',
  second_wind: 'Second Chance',
  boost_reroll: 'Boost Reroll',
};

/** Full-screen mock ad: 3s countdown, then a close (or skip) control. */
export function AdModal() {
  const [request, setRequest] = useState<MockAdRequest | null>(null);
  const [countdown, setCountdown] = useState(CONFIG.mockAdDuration);

  useEffect(() => {
    mockAdController.setHost((req) => {
      setRequest(req);
      setCountdown(CONFIG.mockAdDuration);
    });
    return () => mockAdController.setHost(null);
  }, []);

  useEffect(() => {
    if (!request || countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [request, countdown]);

  const done = countdown <= 0;

  return (
    <AnimatePresence>
      {request && (
        <motion.div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/95 safe-top safe-bottom"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="flex w-72 flex-col items-center gap-6 rounded-2xl border border-white/15 bg-white/5 px-8 py-12">
            <motion.div
              className="text-3xl font-bold tracking-widest text-white/90"
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              AD (mock)
            </motion.div>
            <div className="text-sm uppercase tracking-wider text-white/40">
              {request.kind === 'rewarded'
                ? `Rewarded — ${PLACEMENT_LABELS[request.placement ?? ''] ?? request.placement}`
                : 'Interstitial'}
            </div>
            {!done && (
              <div className="text-5xl font-bold tabular-nums text-white/80">{countdown}</div>
            )}
            {done && (
              <motion.button
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="rounded-full border border-[#00ff88]/60 px-8 py-3 text-lg font-bold text-[#00ff88] shadow-[0_0_18px_rgba(0,255,136,0.35)]"
                onClick={() => mockAdController.finish('completed')}
              >
                {request.kind === 'rewarded' ? 'CLAIM REWARD' : 'CLOSE'}
              </motion.button>
            )}
            {request.kind === 'rewarded' && !done && (
              <button
                className="text-xs uppercase tracking-wider text-white/30 underline"
                onClick={() => mockAdController.finish('skipped')}
              >
                Skip (no reward)
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
