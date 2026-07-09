import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../store/gameStore';

type Step = 'steer' | 'eat' | 'pips' | 'deliver' | 'chain' | 'done';

const STEP_TEXT: Record<Exclude<Step, 'done'>, string> = {
  steer: 'Swipe anywhere to push your orb',
  eat: 'Eat drops to grow your orb',
  pips: 'The dots around your orb are your last 3 catches — majority sets your color',
  deliver: 'Carry your color into the matching ring',
  chain: 'Delivered! Quick repeats build your CHAIN multiplier',
};

const OVERLOAD_TEXT = "Too heavy and you'll overload — deliver before you pop!";
const OVERLOAD_POP_TEXT = 'You popped! Re-collect the scattered drops before they fade';

/** Minimum on-screen time per line, scaled with how long it takes to read. */
const dwellMs = (text: string): number => Math.max(3500, text.split(' ').length * 300);

// Module scope so progress survives remounts (e.g. across a revive).
let coachStep: Step = 'steer';
let overloadTaught = false;
let overloadPopTaught = false;
let damageHintSeen = false;

/**
 * First-run coach: one short, tap-through line at a time, advancing as the
 * player performs each core-loop action. Never pauses or blocks the game.
 */
export function FtueCoach() {
  const phase = useGameStore((s) => s.phase);
  const ftueDone = useGameStore((s) => s.ftueDone);
  const roundsPlayed = useGameStore((s) => s.roundsPlayed);
  if (ftueDone || roundsPlayed > 0 || phase !== 'playing') return null;
  return <CoachInner />;
}

function CoachInner() {
  const pips = useGameStore((s) => s.pips);
  const deliveries = useGameStore((s) => s.deliveries);
  const instability = useGameStore((s) => s.instability);
  const stability = useGameStore((s) => s.stability);
  const overloads = useGameStore((s) => s.overloads);

  const [step, setStepState] = useState<Step>(coachStep);
  const [overloadMsg, setOverloadMsg] = useState(false);
  const [popMsg, setPopMsg] = useState(false);
  const [suppressed, setSuppressed] = useState(false);
  const prevStability = useRef(stability);
  const shownAt = useRef(performance.now());
  const pendingAdvance = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setStep = (s: Step) => {
    coachStep = s;
    shownAt.current = performance.now();
    pendingAdvance.current = null;
    setStepState(s);
  };

  // Advance to the next step, but hold the current line on screen for a
  // minimum dwell so fast players still get to read it.
  const advance = (next: Step) => {
    if (pendingAdvance.current !== null) return;
    const dwell = step !== 'done' ? dwellMs(STEP_TEXT[step]) : 0;
    const left = dwell - (performance.now() - shownAt.current);
    if (left <= 0) setStep(next);
    else pendingAdvance.current = setTimeout(() => setStep(next), left);
  };

  useEffect(
    () => () => {
      if (pendingAdvance.current) clearTimeout(pendingAdvance.current);
      if (overloadTimer.current) clearTimeout(overloadTimer.current);
      if (popTimer.current) clearTimeout(popTimer.current);
    },
    [],
  );

  // Step 1: completes on the first real swipe.
  useEffect(() => {
    if (step !== 'steer') return;
    let sx = 0;
    let sy = 0;
    let down = false;
    let fired = false;
    const onDown = (e: PointerEvent) => {
      down = true;
      sx = e.clientX;
      sy = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (!fired && down && Math.hypot(e.clientX - sx, e.clientY - sy) > 24) {
        fired = true;
        advance('eat');
      }
    };
    const onUp = () => {
      down = false;
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Eat completes on the first catch; the pips line then explains the dots.
  useEffect(() => {
    if (step === 'eat' && pips > 0) advance('pips');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pips]);

  // Pips is informational: show it for a fixed beat, then move on.
  useEffect(() => {
    if (step !== 'pips') return;
    const t = setTimeout(() => setStep('deliver'), 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (step === 'deliver' && deliveries > 0) advance('chain');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, deliveries]);

  // Chain is a transient celebration, then the coach goes quiet.
  useEffect(() => {
    if (step !== 'chain') return;
    const t = setTimeout(() => setStep('done'), 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // One-shot interjection the first time the orb gets dangerously heavy.
  // The hide timer lives in a ref: this effect re-runs on every instability
  // tick, so returning a cleanup here would cancel the timeout immediately.
  useEffect(() => {
    if (!overloadTaught && instability > 0.5) {
      overloadTaught = true;
      setOverloadMsg(true);
      overloadTimer.current = setTimeout(() => setOverloadMsg(false), 4000);
    }
  }, [instability]);

  // The first pop, explained the moment the player is staring at the
  // scattered drops wondering what happened — the real teachable moment.
  useEffect(() => {
    if (!overloadPopTaught && overloads > 0) {
      overloadPopTaught = true;
      setOverloadMsg(false);
      setPopMsg(true);
      popTimer.current = setTimeout(() => setPopMsg(false), 4500);
    }
  }, [overloads]);

  // Yield while the HUD's damage hint is on screen (same trigger: first
  // stability drop) so only one teaching line is ever visible.
  useEffect(() => {
    const prev = prevStability.current;
    prevStability.current = stability;
    if (!damageHintSeen && stability > 0 && stability < prev - 0.01) {
      damageHintSeen = true;
      setSuppressed(true);
      const t = setTimeout(() => setSuppressed(false), 4200);
      return () => clearTimeout(t);
    }
  }, [stability]);

  const text = popMsg
    ? OVERLOAD_POP_TEXT
    : overloadMsg
      ? OVERLOAD_TEXT
      : step !== 'done'
        ? STEP_TEXT[step]
        : null;
  const show = !suppressed && text !== null;

  return (
    <CoachToast
      text={show ? text : null}
      toastKey={popMsg ? 'pop' : overloadMsg ? 'overload' : step}
      urgent={popMsg || overloadMsg}
    />
  );
}

/** Shared one-line coach toast, sitting just above the boost buttons. */
function CoachToast({
  text,
  toastKey,
  urgent,
}: {
  text: string | null;
  toastKey: string;
  urgent: boolean;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 safe-bottom">
      <AnimatePresence mode="wait">
        {text !== null && (
          <motion.div
            key={toastKey}
            className="absolute inset-x-6 bottom-36 flex justify-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.5 } }}
          >
            <span
              className={`rounded-full bg-black/45 px-4 py-1.5 text-center text-base tracking-wide backdrop-blur-[2px] ${
                urgent
                  ? 'text-[#ffd500] [text-shadow:0_0_12px_rgba(255,213,0,0.5)]'
                  : 'text-white/90 [text-shadow:0_0_10px_rgba(255,255,255,0.3)]'
              }`}
            >
              {text}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type RequestKind = 'minMass' | 'rush' | 'pure' | 'bonus';

const REQUEST_TEXT: Record<RequestKind, string> = {
  minMass: 'This portal wants a bigger orb — grow it to the number shown first',
  rush: 'RUSH — half the time, double the score!',
  pure: 'PURE — all 3 of your dots must match the color',
  bonus: 'BONUS RING — double Sparks, and no harm done if it fades',
};

/**
 * Teaches the portal's special request labels ("N+", "2x", "PURE") the
 * first time each is ever on screen. Unlike the first-run coach these can
 * appear on any run (they're difficulty-ramped), so this runs forever and
 * marks each label as taught in the persisted save.
 */
export function RequestCoach() {
  const phase = useGameStore((s) => s.phase);
  if (phase !== 'playing') return null;
  return <RequestCoachInner />;
}

function RequestCoachInner() {
  const requestType = useGameStore((s) => s.requestType);
  const requestMinMass = useGameStore((s) => s.requestMinMass);
  const bonusActive = useGameStore((s) => s.bonusActive);
  const bonusDeliveries = useGameStore((s) => s.bonusDeliveries);
  const taught = useGameStore((s) => s.requestsTaught);
  const markRequestTaught = useGameStore((s) => s.markRequestTaught);
  const roundsPlayed = useGameStore((s) => s.roundsPlayed);
  const ftueDone = useGameStore((s) => s.ftueDone);

  const [toast, setToast] = useState<RequestKind | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  // Bonus is taught by *use*, not by sighting: the line stays up for the
  // whole life of every bonus portal until the player banks one, then
  // retires forever.
  useEffect(() => {
    if (bonusDeliveries > 0 && !taught.bonus) markRequestTaught('bonus');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bonusDeliveries, taught.bonus]);

  const firstRunCoachBusy = roundsPlayed === 0 && !ftueDone && coachStep !== 'done';
  const bonusCoach = bonusActive && !taught.bonus && !firstRunCoachBusy;

  useEffect(() => {
    if (toast) return; // one line at a time
    // Yield while the first-run coach still owns the toast slot; untaught
    // labels simply wait for a later sighting. Same while the persistent
    // bonus line has the slot — marking a label it would hide wastes it.
    if (firstRunCoachBusy || bonusCoach) return;
    const kind: RequestKind | null =
      requestMinMass > 0
        ? 'minMass'
        : requestType === 'rush'
          ? 'rush'
          : requestType === 'pure'
            ? 'pure'
            : null;
    if (!kind || taught[kind]) return;
    markRequestTaught(kind);
    setToast(kind);
    hideTimer.current = setTimeout(() => setToast(null), 4500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestType, requestMinMass, taught, toast, firstRunCoachBusy, bonusCoach]);

  return (
    <CoachToast
      text={bonusCoach ? REQUEST_TEXT.bonus : toast ? REQUEST_TEXT[toast] : null}
      toastKey={bonusCoach ? 'bonus' : (toast ?? 'none')}
      urgent
    />
  );
}
