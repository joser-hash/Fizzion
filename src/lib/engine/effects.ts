import { rand, TAU } from './utils';

export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface Shockwave {
  x: number;
  y: number;
  r: number;
  maxR: number;
  life: number;
  maxLife: number;
  color: string;
  width: number;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

/** Transient visual effects + screen shake + full-screen flash. */
export class Effects {
  sparks: Spark[] = [];
  shocks: Shockwave[] = [];
  texts: FloatText[] = [];

  private shakeAmp = 0;
  private shakeLeft = 0;
  private shakeDur = 1;
  offsetX = 0;
  offsetY = 0;

  flashColor = '#fff';
  flashAlpha = 0;

  burst(x: number, y: number, color: string, count: number, speed = 180): void {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const s = rand(speed * 0.3, speed);
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.25, 0.55),
        maxLife: 0.55,
        size: rand(1.5, 3.5),
        color,
      });
    }
  }

  /** Directed spray of sparks from (x,y) toward (tx,ty) — the delivery jet. */
  jet(x: number, y: number, tx: number, ty: number, color: string, count: number): void {
    const base = Math.atan2(ty - y, tx - x);
    const d = Math.hypot(tx - x, ty - y);
    for (let i = 0; i < count; i++) {
      const a = base + rand(-0.35, 0.35);
      const s = rand(d * 1.6, d * 3);
      this.sparks.push({
        x: x + rand(-6, 6),
        y: y + rand(-6, 6),
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.25, 0.5),
        maxLife: 0.5,
        size: rand(2, 4.5),
        color,
      });
    }
  }

  shockwave(x: number, y: number, color: string, maxR: number, width = 6, lifeS = 0.5): void {
    this.shocks.push({ x, y, r: 4, maxR, life: lifeS, maxLife: lifeS, color, width });
  }

  text(x: number, y: number, str: string, color: string, size = 22): void {
    this.texts.push({ x, y, text: str, color, life: 1, maxLife: 1, size });
  }

  shake(amp: number, durationMs: number): void {
    if (amp >= this.shakeAmp || this.shakeLeft <= 0) {
      this.shakeAmp = amp;
      this.shakeDur = durationMs / 1000;
      this.shakeLeft = this.shakeDur;
    }
  }

  flash(color: string, alpha: number): void {
    this.flashColor = color;
    this.flashAlpha = Math.max(this.flashAlpha, alpha);
  }

  update(dt: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= Math.pow(0.02, dt); // heavy damping so bursts stay tight
      s.vy *= Math.pow(0.02, dt);
    }

    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const w = this.shocks[i];
      w.life -= dt;
      if (w.life <= 0) {
        this.shocks.splice(i, 1);
        continue;
      }
      const p = 1 - w.life / w.maxLife;
      w.r = 4 + (w.maxR - 4) * (1 - Math.pow(1 - p, 3));
    }

    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.y -= 45 * dt;
      if (t.life <= 0) this.texts.splice(i, 1);
    }

    if (this.shakeLeft > 0) {
      this.shakeLeft = Math.max(0, this.shakeLeft - dt);
      const k = this.shakeLeft / this.shakeDur; // linear decay
      const a = this.shakeAmp * k * k;
      this.offsetX = rand(-a, a);
      this.offsetY = rand(-a, a);
      if (this.shakeLeft === 0) this.shakeAmp = 0;
    } else {
      this.offsetX = 0;
      this.offsetY = 0;
    }

    this.flashAlpha = Math.max(0, this.flashAlpha - dt * 0.4);
  }

  clear(): void {
    this.sparks.length = 0;
    this.shocks.length = 0;
    this.texts.length = 0;
    this.shakeLeft = 0;
    this.shakeAmp = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.flashAlpha = 0;
  }
}
