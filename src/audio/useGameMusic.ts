import { useSyncExternalStore } from 'react';

/**
 * Looping background music via the Web Audio API.
 *
 * The track has a one-time soft intro followed by a looping main section.
 * A single AudioBufferSourceNode plays the whole file once and then loops
 * [loopStart, loopEnd] forever — sample-accurate, which <audio> cannot do.
 *
 * All state is module-level (one shared AudioContext, one decoded buffer,
 * at most one live source), so React 19 StrictMode double-invoking effects
 * or repeated gestures can never stack two copies of the music.
 */

/** First sample of the loop section in the authored 44.1 kHz file. */
const LOOP_START_SAMPLE = 1032689;
const AUTHORED_SAMPLE_RATE = 44100;

/** Preference order: ogg for Chrome/Firefox, m4a fallback for Safari.
 * BASE_URL keeps the paths correct when deployed under a subpath (Pages). */
const TRACK_URLS = [
  `${import.meta.env.BASE_URL}audio/futuristic-game-music-intro-loop.ogg`,
  `${import.meta.env.BASE_URL}audio/futuristic-game-music-intro-loop.m4a`,
];

/** Ambience level: the music sits under the synth SFX, not over them. */
const DEFAULT_VOLUME = 0.175;
const VOLUME_RAMP_S = 0.05;
const FADE_OUT_S = 0.3;

let ctx: AudioContext | null = null;
let gain: GainNode | null = null;
let buffer: AudioBuffer | null = null;
let bufferPromise: Promise<AudioBuffer> | null = null;
let source: AudioBufferSourceNode | null = null;
let fadeTimer: ReturnType<typeof setTimeout> | null = null;
let volume = DEFAULT_VOLUME;
let playing = false;
/** Bumped on every start/stop; async work bails if it's no longer current. */
let generation = 0;

const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((l) => l());

function ensureContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/**
 * Resolve once the context is allowed to produce sound. Called from a user
 * gesture this resolves immediately; called on page load (autoplay blocked)
 * it waits for the first tap/key and resumes then — so music can be
 * requested as soon as the title screen mounts.
 */
function unlockContext(audioCtx: AudioContext): Promise<void> {
  if (audioCtx.state === 'running') return Promise.resolve();
  return new Promise((resolve) => {
    const cleanup = () => {
      window.removeEventListener('pointerdown', tryResume);
      window.removeEventListener('keydown', tryResume);
      audioCtx.removeEventListener('statechange', onState);
    };
    const onState = () => {
      if (audioCtx.state === 'running') {
        cleanup();
        resolve();
      }
    };
    const tryResume = () => void audioCtx.resume();
    audioCtx.addEventListener('statechange', onState);
    window.addEventListener('pointerdown', tryResume);
    window.addEventListener('keydown', tryResume);
    void audioCtx.resume();
    onState(); // may already be running
  });
}

async function loadBuffer(audioCtx: AudioContext): Promise<AudioBuffer> {
  if (buffer) return buffer;
  bufferPromise ??= (async () => {
    let lastError: unknown = null;
    for (const url of TRACK_URLS) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const decoded = await audioCtx.decodeAudioData(await res.arrayBuffer());
        buffer = decoded;
        return decoded;
      } catch (e) {
        lastError = e; // e.g. Safari can't decode ogg -> try the m4a
      }
    }
    bufferPromise = null; // allow a retry on a later gesture
    throw lastError instanceof Error ? lastError : new Error('music decode failed');
  })();
  return bufferPromise;
}

/** Kill the live source immediately (no fade). */
function teardownSource(): void {
  if (fadeTimer !== null) {
    clearTimeout(fadeTimer);
    fadeTimer = null;
  }
  if (source) {
    try {
      source.stop();
    } catch {
      // already stopped
    }
    source.disconnect();
    source = null;
  }
}

/** Start the music from the very beginning (intro, then endless loop). */
export async function startMusic(): Promise<void> {
  if (playing) return;
  playing = true;
  const gen = ++generation;
  notify();

  const audioCtx = ensureContext();
  let decoded: AudioBuffer;
  try {
    // Fetch/decode and the autoplay unlock run in parallel: on a blocked
    // page load the buffer is ready the instant the first gesture lands.
    [decoded] = await Promise.all([loadBuffer(audioCtx), unlockContext(audioCtx)]);
  } catch {
    if (generation === gen) {
      playing = false;
      notify();
    }
    return; // no music is a soft failure — the game plays on
  }
  // Stopped (or restarted) while we were fetching/decoding/waiting.
  if (generation !== gen) return;

  teardownSource(); // paranoia: never two sources
  const src = audioCtx.createBufferSource();
  src.buffer = decoded;
  src.loop = true;
  // The loop point is authored in 44.1 kHz samples; loopStart/loopEnd are
  // seconds, so this stays correct even if decoding resampled the buffer.
  src.loopStart = LOOP_START_SAMPLE / AUTHORED_SAMPLE_RATE;
  src.loopEnd = decoded.duration;

  const g = gain!;
  g.gain.cancelScheduledValues(audioCtx.currentTime);
  g.gain.setValueAtTime(volume, audioCtx.currentTime);
  src.connect(g);
  src.start(0);
  source = src;
}

/** Fade out over ~300 ms, then stop. The next start() replays the intro. */
export function stopMusic(): void {
  if (!playing) return;
  playing = false;
  generation++;
  notify();
  if (!ctx || !gain || !source) return;

  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(0, t + FADE_OUT_S);
  fadeTimer = setTimeout(() => {
    fadeTimer = null;
    teardownSource();
    // Restore the gain for the next start (it ramped to 0 for the fade).
    if (ctx && gain) gain.gain.setValueAtTime(volume, ctx.currentTime);
  }, FADE_OUT_S * 1000 + 50);
}

/** Set music volume (0..1) with a short click-free ramp. */
export function setMusicVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  if (!ctx || !gain || !playing) return;
  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(volume, t + VOLUME_RAMP_S);
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getIsPlaying = (): boolean => playing;

/** Introspection for tests / debug tooling. */
export function getMusicState(): {
  playing: boolean;
  hasSource: boolean;
  contextState: string | null;
  loopStart: number | null;
  loopEnd: number | null;
  volume: number;
} {
  return {
    playing,
    hasSource: !!source,
    contextState: ctx?.state ?? null,
    loopStart: source?.loopStart ?? null,
    loopEnd: source?.loopEnd ?? null,
    volume,
  };
}

export interface GameMusic {
  start: () => Promise<void>;
  stop: () => void;
  setVolume: (v: number) => void;
  isPlaying: boolean;
}

/** React handle over the singleton player; `isPlaying` is reactive. */
export function useGameMusic(): GameMusic {
  const isPlaying = useSyncExternalStore(subscribe, getIsPlaying);
  return { start: startMusic, stop: stopMusic, setVolume: setMusicVolume, isPlaying };
}
