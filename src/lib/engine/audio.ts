/**
 * Web Audio synthesizer — all game sound is generated, no files.
 * The context is created/resumed on the first user gesture (mobile requirement).
 */
class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private mutedFlag = false;

  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  setMuted(m: boolean): void {
    this.mutedFlag = m;
  }

  private get ready(): boolean {
    return !this.mutedFlag && !!this.ctx && this.ctx.state === 'running' && !!this.master;
  }

  private noise(): AudioBuffer {
    const ctx = this.ctx!;
    if (!this.noiseBuf) {
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    return this.noiseBuf;
  }

  /** Soft pop per particle eaten; pitch rises with the same-color streak. */
  pop(streak: number): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const freq = 420 * Math.pow(2, Math.min(streak, 10) * 0.09);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.6, t + 0.06);
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  /**
   * Warm chime on delivery; higher pitch per chain level. Tier (0-3, from
   * delivered mass) adds harmonic layers and a sub-thump for big orbs.
   */
  chime(chainLevel: number, tier = 0): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const base = 523.25 * Math.pow(2, Math.min(chainLevel - 1, 10) * (2 / 12));
    const partials: Array<readonly [number, number, number]> = [
      [1, 0.22, 0.55],
      [1.5, 0.1, 0.45],
      [2, 0.05, 0.35],
    ];
    if (tier >= 1) partials.push([3, 0.035 + tier * 0.015, 0.5 + tier * 0.1]);
    if (tier >= 2) partials.push([0.5, 0.12, 0.6], [4, 0.03, 0.4]);
    for (const [mult, gain, decay] of partials) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = base * mult;
      g.gain.setValueAtTime(gain * (1 + tier * 0.15), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + decay + 0.05);
    }
    if (tier >= 2) {
      // Sub-thump: big orbs land with weight.
      const sub = ctx.createOscillator();
      const sg = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(90, t);
      sub.frequency.exponentialRampToValueAtTime(40, t + 0.3);
      sg.gain.setValueAtTime(0.18 + tier * 0.06, t);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      sub.connect(sg).connect(this.master!);
      sub.start(t);
      sub.stop(t + 0.4);
    }
  }

  /** Low heartbeat blip while stability is critical. */
  warn(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(170, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.11);
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  /** Dull thud for portal rejection. */
  thud(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.16);
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.22);
  }

  /** Tiny crackle blip; fired repeatedly as instability grows. */
  crackle(intensity: number): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    src.playbackRate.value = 0.6 + Math.random() * 1.4;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200 + Math.random() * 2800;
    bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.02 + 0.05 * intensity, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5, 0.05);
  }

  /** Big filtered-noise boom on overload. */
  boom(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(50, t + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
    src.connect(lp).connect(g).connect(this.master!);
    src.start(t, 0, 0.9);

    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(65, t);
    sub.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    sg.gain.setValueAtTime(0.4, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    sub.connect(sg).connect(this.master!);
    sub.start(t);
    sub.stop(t + 0.6);
  }

  /**
   * Power Surge slam: rising charge-up whoosh into a bright impact stab,
   * scheduled so the hit lands with the title spring (~0.15s in). Positive
   * cousin of boom() — the noise sweeps up, not down, and the stab shares
   * the delivery chime's harmonic family.
   */
  surge(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const impact = t + 0.15; // matches the title landing / flash / shake

    // Riser: pitch sweep climbing into the hit.
    const rise = ctx.createOscillator();
    const rg = ctx.createGain();
    rise.type = 'sawtooth';
    rise.frequency.setValueAtTime(160, t);
    rise.frequency.exponentialRampToValueAtTime(880, impact);
    rg.gain.setValueAtTime(0.04, t);
    rg.gain.exponentialRampToValueAtTime(0.12, impact);
    rg.gain.exponentialRampToValueAtTime(0.0001, impact + 0.05);
    rise.connect(rg).connect(this.master!);
    rise.start(t);
    rise.stop(impact + 0.1);

    // Whoosh: noise through an opening highpass (anticipation, not collapse).
    const wh = ctx.createBufferSource();
    wh.buffer = this.noise();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(400, t);
    hp.frequency.exponentialRampToValueAtTime(3200, impact);
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0.02, t);
    wg.gain.exponentialRampToValueAtTime(0.1, impact);
    wg.gain.exponentialRampToValueAtTime(0.0001, impact + 0.08);
    wh.connect(hp).connect(wg).connect(this.master!);
    wh.start(t, 0, 0.35);

    // Impact: bright electric stab (root + fifth + octave).
    for (const [freq, gain, decay] of [
      [523.25, 0.2, 0.35],
      [784, 0.1, 0.3],
      [1046.5, 0.06, 0.25],
    ] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.setValueAtTime(gain, impact);
      g.gain.exponentialRampToValueAtTime(0.0001, impact + decay);
      osc.connect(g).connect(this.master!);
      osc.start(impact);
      osc.stop(impact + decay + 0.05);
    }

    // Short punchy thump — weight without the overload's doom rumble.
    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(130, impact);
    sub.frequency.exponentialRampToValueAtTime(60, impact + 0.18);
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.setValueAtTime(0.22, impact);
    sg.gain.exponentialRampToValueAtTime(0.0001, impact + 0.22);
    sub.connect(sg).connect(this.master!);
    sub.start(impact);
    sub.stop(impact + 0.25);
  }

  /** Faint tick used by the results-screen score count-up. */
  tick(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 1300 + Math.random() * 200;
    g.gain.setValueAtTime(0.03, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.04);
  }
}

export const audio = new Synth();
