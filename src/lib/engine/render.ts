import { CONFIG } from '../constants';
import { runMods } from '../boosts';
import { clamp, TAU } from './utils';
import type { Orb } from './orb';
import { orbRadius } from './orb';
import type { FoodParticle } from './particles';
import type { Hazard } from './hazard';
import type { Portal } from './portal';
import { portalScale } from './portal';
import type { Effects } from './effects';

export interface Scene {
  orb: Orb;
  particles: FoodParticle[];
  portal: Portal;
  /** Bonus portal currently open, or null. */
  bonusPortal: Portal | null;
  hazards: Hazard[];
  effects: Effects;
  /** Instability 0..1 (drawn as an arc around the orb). */
  instability: number;
  /** Run life bar 0..1 (drawn along the top edge). */
  stability: number;
  /** Combo heat normalized 0..1 (drives ambient escalation). */
  heat: number;
  /** False on menu/results: hides run-only chrome (stability bar, vignette). */
  playing: boolean;
  /** Quality tier from the governor (0 = full ... 2 = low). */
  quality: number;
  time: number;
  /** Live drag vector while the player is aiming, or null. */
  drag: { x: number; y: number; dx: number; dy: number } | null;
  /** Learner run before the first delivery: draw self-teaching guides. */
  ftueGuide: boolean;
}

/** Ring glow passes, widest first (lower quality tiers skip from the front). */
const RING_PASSES: readonly (readonly [number, number])[] = [
  [3.2, 0.12],
  [1.8, 0.3],
  [1, 1],
];

/**
 * All drawing is procedural. Glow uses pre-rendered radial-gradient
 * sprites (drawn at init, still zero assets) composited with 'lighter'
 * for additive bloom — much cheaper than shadowBlur on mobile.
 */
export class Renderer {
  private sprites = new Map<string, HTMLCanvasElement>();
  /** Baked halo/core sprites for dot-like glows (see haloSprite/coreSprite). */
  private dotSprites = new Map<string, HTMLCanvasElement>();
  private vignetteSprite: HTMLCanvasElement | null = null;
  /** Current quality tier, latched from the Scene each frame. */
  private q = 0;

  // Stability bar animation state.
  private dispStability = 1;
  private lastStability = 1;
  private stabilityGhosts: { from: number; to: number; life: number }[] = [];
  private restorePulse = 0;
  private lastTime = 0;

  private sprite(color: string): HTMLCanvasElement {
    let s = this.sprites.get(color);
    if (!s) {
      const size = 128;
      s = document.createElement('canvas');
      s.width = size;
      s.height = size;
      const c = s.getContext('2d')!;
      const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, color);
      g.addColorStop(0.25, color + 'aa');
      g.addColorStop(0.6, color + '33');
      g.addColorStop(1, color + '00');
      c.fillStyle = g;
      c.fillRect(0, 0, size, size);
      this.sprites.set(color, s);
    }
    return s;
  }

  /**
   * Both glow halos baked into one sprite per color. Baked additively
   * ('lighter'), and the summed center alpha (0.32 + 0.55) never clamps,
   * so one draw of this sprite is mathematically identical to the two
   * separate halo draws it replaces. Sprite radius = 3x the core radius.
   */
  private haloSprite(color: string, full: boolean): HTMLCanvasElement {
    const key = `${color}|${full ? 'hi' : 'lo'}`;
    let s = this.dotSprites.get(key);
    if (!s) {
      const size = 192;
      const core = size / 6; // core radius r within the sprite
      s = document.createElement('canvas');
      s.width = size;
      s.height = size;
      const c = s.getContext('2d')!;
      c.globalCompositeOperation = 'lighter';
      const spr = this.sprite(color);
      const cx = size / 2;
      // The wide halo is the most fill-rate-hungry layer: low tiers skip it.
      if (full) {
        c.globalAlpha = 0.32;
        c.drawImage(spr, cx - core * 3, cx - core * 3, core * 6, core * 6);
      }
      c.globalAlpha = 0.55;
      c.drawImage(spr, cx - core * 1.7, cx - core * 1.7, core * 3.4, core * 3.4);
      this.dotSprites.set(key, s);
    }
    return s;
  }

  /** Solid antialiased disc, replacing a per-call arc()+fill path raster. */
  private coreSprite(color: string): HTMLCanvasElement {
    const key = `${color}|core`;
    let s = this.dotSprites.get(key);
    if (!s) {
      const size = 64;
      s = document.createElement('canvas');
      s.width = size;
      s.height = size;
      const c = s.getContext('2d')!;
      c.fillStyle = color;
      c.beginPath();
      c.arc(size / 2, size / 2, size / 2, 0, TAU);
      c.fill();
      this.dotSprites.set(key, s);
    }
    return s;
  }

  /**
   * Layered glow (soft halos + bright core) in two pre-baked drawImages —
   * the hot path for particles, sparks, pips and sparkles.
   */
  private glow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    color: string,
    alpha = 1,
  ): void {
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.haloSprite(color, this.q < 1), x - r * 3, y - r * 3, r * 6, r * 6);
    ctx.drawImage(this.coreSprite(color), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }

  private ring(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    color: string,
    baseWidth: number,
    alpha = 1,
    from = 0,
    to = TAU,
  ): void {
    if (r <= 0.1) return; // negative radii throw (decay wobble can dip below 0)
    // Widest glow passes go first, so lower tiers can just skip them.
    for (let i = this.q; i < RING_PASSES.length; i++) {
      const [wMul, aMul] = RING_PASSES[i];
      ctx.globalAlpha = alpha * aMul;
      ctx.strokeStyle = color;
      ctx.lineWidth = baseWidth * wMul;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(x, y, r, from, to);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  render(ctx: CanvasRenderingContext2D, s: Scene, w: number, h: number): void {
    this.q = s.quality;
    const dt = clamp(s.time - this.lastTime, 0, 0.1);
    this.lastTime = s.time;
    this.updateStabilityAnim(s.stability, dt);

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(s.effects.offsetX, s.effects.offsetY);
    ctx.globalCompositeOperation = 'lighter';

    this.drawTrail(ctx, s.orb, s.heat);
    this.drawParticles(ctx, s);
    if (s.ftueGuide && s.playing) this.drawFtueGuide(ctx, s);
    this.drawPortal(ctx, s);
    if (s.bonusPortal) this.drawBonusPortal(ctx, s.bonusPortal, s.time);
    for (const hz of s.hazards) this.drawHazard(ctx, hz, s.time);
    this.drawDrag(ctx, s);
    this.drawOrb(ctx, s);
    this.drawEffects(ctx, s.effects);
    if (s.playing) this.drawStabilityBar(ctx, s, w);

    ctx.restore();

    // Drawn outside the 'lighter' block: a source-over tint hugs the edges
    // instead of additively blooming every glow it overlaps.
    if (s.playing) this.drawVignette(ctx, s, w, h);

    if (s.effects.flashAlpha > 0.002) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = s.effects.flashAlpha;
      ctx.fillStyle = s.effects.flashColor;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  }

  private drawTrail(ctx: CanvasRenderingContext2D, orb: Orb, heat: number): void {
    const n = orb.trail.length;
    if (n < 2) return;
    const r = orbRadius(orb);
    const spr = this.sprite(orb.color);
    const glow = 0.3 * (1 + heat * 0.8); // combo heat brightens the trail
    const stride = this.q + 1; // thin the trail on lower tiers
    for (let i = n - 1; i >= 0; i -= stride) {
      const t = i / n;
      const alpha = Math.min(1, t * t * glow);
      if (alpha < 0.02) break; // older points only get fainter
      const p = orb.trail[i];
      const size = r * (0.25 + 0.65 * t);
      ctx.globalAlpha = alpha;
      ctx.drawImage(spr, p.x - size, p.y - size, size * 2, size * 2);
    }
    ctx.globalAlpha = 1;
  }

  /** Track drops/restores so damage is animated rather than instantaneous. */
  private updateStabilityAnim(stability: number, dt: number): void {
    const cur = clamp(stability, 0, 1);
    if (cur < this.lastStability - 0.005) {
      this.stabilityGhosts.push({ from: this.lastStability, to: cur, life: 0.7 });
    } else if (cur > this.lastStability + 0.005) {
      this.restorePulse = 1;
    }
    this.lastStability = cur;

    this.dispStability += (cur - this.dispStability) * Math.min(1, dt * 7);
    if (Math.abs(cur - this.dispStability) < 0.002) this.dispStability = cur;

    for (let i = this.stabilityGhosts.length - 1; i >= 0; i--) {
      this.stabilityGhosts[i].life -= dt;
      if (this.stabilityGhosts[i].life <= 0) this.stabilityGhosts.splice(i, 1);
    }
    this.restorePulse = Math.max(0, this.restorePulse - dt * 2.2);
  }

  /**
   * Segmented glowing life bar along the top edge. Damage leaves a fading
   * red ghost of the lost chunk; restores pulse green; critical blinks pink.
   */
  private drawStabilityBar(ctx: CanvasRenderingContext2D, s: Scene, w: number): void {
    const margin = 16;
    const y = 12;
    const span = w - margin * 2;
    const segments = 6;
    const gap = 4;
    const segW = (span - gap * (segments - 1)) / segments;

    const frac = this.dispStability;
    const critical = clamp(s.stability, 0, 1) < CONFIG.stabilityWarnAt;
    const color = critical ? '#ff2975' : '#00ff88';
    let alpha = 0.9;
    if (critical) {
      alpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(s.time * 7 * TAU * 0.5));
    }

    const strokeSpan = (from: number, to: number, col: string, a: number, width: number) => {
      // Draw the [from..to] fraction across the segmented layout.
      for (let i = 0; i < segments; i++) {
        const a0 = i / segments;
        const a1 = (i + 1) / segments;
        const lo = Math.max(from, a0);
        const hi = Math.min(to, a1);
        if (hi - lo <= 0.0001) continue;
        const segX = margin + i * (segW + gap);
        const x1 = segX + ((lo - a0) / (a1 - a0)) * segW;
        const x2 = segX + ((hi - a0) / (a1 - a0)) * segW;
        ctx.globalAlpha = a;
        ctx.strokeStyle = col;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(Math.max(x1 + 0.5, x2), y);
        ctx.stroke();
      }
    };

    // Faint track for all segments.
    strokeSpan(0, 1, '#ffffff', 0.09, 3);
    // Filled portion with layered glow.
    if (frac > 0.002) {
      strokeSpan(0, frac, color, alpha * 0.12, 12);
      strokeSpan(0, frac, color, alpha * 0.3, 8);
      strokeSpan(0, frac, color, alpha, 5);
    }
    // Damage ghosts: the chunk just lost lingers in red and fades.
    for (const g of this.stabilityGhosts) {
      const ga = (g.life / 0.7) * 0.9;
      strokeSpan(g.to, g.from, '#ff2975', ga, 5);
      strokeSpan(g.to, g.from, '#ff2975', ga * 0.3, 10);
    }
    // Restore pulse: brief white-hot overlay on the filled part.
    if (this.restorePulse > 0.01 && frac > 0.002) {
      strokeSpan(0, frac, '#ffffff', this.restorePulse * 0.55, 5);
    }
    ctx.globalAlpha = 1;
  }

  /** Pulsing red edge vignette while stability is critical. */
  private drawVignette(ctx: CanvasRenderingContext2D, s: Scene, w: number, h: number): void {
    if (s.stability >= CONFIG.stabilityWarnAt) return;
    if (!this.vignetteSprite) {
      const size = 256;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const g = c.getContext('2d')!;
      // Transparent well past mid-screen; full red only out by the corners.
      const grad = g.createRadialGradient(
        size / 2, size / 2, size * 0.33,
        size / 2, size / 2, size * 0.6,
      );
      grad.addColorStop(0, '#ff297500');
      grad.addColorStop(1, '#ff2975');
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      this.vignetteSprite = c;
    }
    const depth = 1 - s.stability / CONFIG.stabilityWarnAt; // 0 at threshold -> 1 at zero
    const pulse = 0.5 + 0.5 * Math.sin(s.time * (3 + depth * 6));
    ctx.globalAlpha = (0.14 + depth * 0.3) * (0.55 + 0.45 * pulse);
    ctx.drawImage(this.vignetteSprite, -w * 0.12, -h * 0.12, w * 1.24, h * 1.24);
    ctx.globalAlpha = 1;
  }

  /**
   * Learner-run guide (pre-first-delivery): once the orb matches the
   * request, marching dots lead from the orb to the portal — "you're
   * ready, go there" with zero reading required.
   */
  private drawFtueGuide(ctx: CanvasRenderingContext2D, s: Scene): void {
    const { orb } = s;
    if (orb.pips.length === 0) return;
    // Lead to the main portal when it matches; otherwise to a matching
    // bonus portal (so the guide never points at an ineligible ring).
    let portal = s.portal;
    let radius = CONFIG.portalRadius;
    if (orb.color !== portal.color || portal.rerollLeft > 0) {
      const bp = s.bonusPortal;
      if (!bp || orb.color !== bp.color || bp.rerollLeft > 0) return;
      portal = bp;
      radius = CONFIG.bonusRadius;
    }
    const dx = portal.x - orb.x;
    const dy = portal.y - orb.y;
    const dist = Math.hypot(dx, dy);
    const start = orbRadius(orb) + 24;
    const end = dist - radius - 20;
    if (end <= start) return;
    const nx = dx / dist;
    const ny = dy / dist;
    const spacing = 26;
    const march = (s.time * 40) % spacing; // dots flow toward the portal
    const pulse = 0.5 + 0.2 * Math.sin(s.time * 3);
    for (let d = start + march; d < end; d += spacing) {
      // Fade in from the orb side so the trail doesn't crowd the player.
      const t = (d - start) / (end - start);
      ctx.globalAlpha = pulse * (0.35 + 0.65 * t);
      const size = 2.2 + t * 1.2;
      ctx.fillStyle = portal.color;
      ctx.beginPath();
      ctx.arc(orb.x + nx * d, orb.y + ny * d, size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawParticles(ctx: CanvasRenderingContext2D, s: Scene): void {
    for (const p of s.particles) {
      const pulse = 1 + 0.16 * Math.sin(p.phase);
      let alpha = 1;
      let r = CONFIG.particleRadius * pulse;
      if (p.state === 'attract') {
        r *= 1 - p.attractT * 0.5;
      }
      if (p.expireLife !== undefined) {
        // Blink faster as expiry approaches.
        const frac = p.expireLife / CONFIG.overloadParticleLife;
        const blinkHz = 3 + (1 - frac) * 14;
        alpha = frac < 0.85 ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(s.time * blinkHz * TAU)) : 1;
        alpha *= clamp(frac * 3, 0, 1) * 0.5 + 0.5;
      }
      this.glow(ctx, p.x, p.y, r, p.color, alpha);
    }
  }

  private drawPortal(ctx: CanvasRenderingContext2D, s: Scene): void {
    const p = s.portal;
    const scale = portalScale(p);
    if (scale <= 0.02) return;

    // Portal decay: the ring dims, wobbles, and sputters as stability falls.
    const stab = clamp(s.stability, 0, 1);
    const decay = 1 - stab;
    const critical = stab < CONFIG.stabilityWarnAt;
    const wobble =
      Math.sin(s.time * 11) * decay * 2.5 + (critical ? (Math.random() - 0.5) * 2.4 : 0);
    // Clamp: while the ring is fully collapsed mid-reroll, the decay wobble
    // could otherwise push the radius negative and throw in arc().
    const r = Math.max(
      0.5,
      CONFIG.portalRadius * scale * (1 + 0.03 * Math.sin(s.time * 1.8)) + wobble,
    );

    let alpha = 0.55 + 0.45 * stab;
    if (critical) alpha *= 0.65 + 0.35 * Math.random(); // sputter
    if (p.timeLeft < CONFIG.portalUrgencyTime && p.rerollLeft <= 0 && p.lockLeft <= 0) {
      const urgency = 1 - p.timeLeft / CONFIG.portalUrgencyTime;
      const hz = 4 + urgency * 10;
      alpha *= 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(s.time * hz * TAU));
    }

    this.ring(ctx, p.x, p.y, r, p.color, 3, alpha);

    // Pure requests: triple concentric rings signal "all pips must match".
    if (p.requestType === 'pure' && scale > 0.85) {
      this.ring(ctx, p.x, p.y, r * 0.8, p.color, 1.2, alpha * 0.7);
      this.ring(ctx, p.x, p.y, r * 0.62, p.color, 1, alpha * 0.5);
    }

    // Shrinking arc = time remaining on the request (white for rush).
    const frac = clamp(p.timeLeft / p.duration, 0, 1);
    if (frac > 0 && scale > 0.9) {
      const start = -Math.PI / 2;
      const arcColor = p.lockLeft > 0 || p.requestType === 'rush' ? '#ffffff' : p.color;
      this.ring(ctx, p.x, p.y, r + 11, arcColor, 1.6, 0.85, start, start + TAU * frac);
    }

    // Demand label inside the ring: min-mass ("6+") or rush ("2x").
    const label =
      p.minMass > 0 ? `${p.minMass}+` : p.requestType === 'rush' ? '2x' : '';
    if (label && scale > 0.85) {
      ctx.globalAlpha = alpha * (0.75 + 0.25 * Math.sin(s.time * 3));
      ctx.fillStyle = p.color;
      ctx.font = `800 20px 'Oxanium', ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, p.x, p.y);
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = 1;
    }
    // "PURE" tag under the ring.
    if (p.requestType === 'pure' && scale > 0.85) {
      ctx.globalAlpha = alpha * 0.85;
      ctx.fillStyle = p.color;
      ctx.font = `800 11px 'Oxanium', ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('P U R E', p.x, p.y + r + 24);
      ctx.globalAlpha = 1;
    }

    // Orbiting sparkles (more of them while the combo runs hot).
    const sparkles = this.q === 0 ? 5 + Math.round(s.heat * 3) : this.q === 1 ? 3 : 2;
    for (let i = 0; i < sparkles; i++) {
      const a = p.rotation * 1.6 + (i * TAU) / sparkles;
      const sx = p.x + Math.cos(a) * (r + 18);
      const sy = p.y + Math.sin(a) * (r + 18);
      const tw = 0.5 + 0.5 * Math.sin(s.time * 5 + i * 1.7);
      this.glow(ctx, sx, sy, 1.6 + tw, p.color, 0.5 + 0.5 * tw);
    }

    // Inner rotating dashes give the ring visible spin.
    ctx.globalAlpha = 0.6 * alpha;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a0 = p.rotation + (i * TAU) / 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.72, a0, a0 + 0.9);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (p.rejectFlash > 0) {
      this.ring(ctx, p.x, p.y, r + 4, '#9a9a9a', 4, p.rejectFlash);
    }
    if (p.successFlash > 0) {
      this.ring(ctx, p.x, p.y, r + 6, '#ffffff', 5, p.successFlash);
      this.glow(ctx, p.x, p.y, r * 0.5, p.color, p.successFlash * 0.8);
    }
    if (p.lockLeft > 0) {
      // Steady white halo communicates "frozen".
      this.ring(ctx, p.x, p.y, r + 20, '#ffffff', 1.2, 0.35 + 0.15 * Math.sin(s.time * 6));
    }
  }

  /**
   * Bonus portal: a smaller ring in the request color wrapped in a golden
   * outer ring — reads as "same job, special prize". No decay/lock states;
   * it only ever counts down.
   */
  private drawBonusPortal(ctx: CanvasRenderingContext2D, p: Portal, time: number): void {
    const gold = '#ffd500';
    const scale = portalScale(p);
    if (scale <= 0.02) return;
    const r = Math.max(0.5, CONFIG.bonusRadius * scale * (1 + 0.04 * Math.sin(time * 2.2)));

    let alpha = 0.95;
    if (p.timeLeft < CONFIG.portalUrgencyTime && p.rerollLeft <= 0) {
      const urgency = 1 - p.timeLeft / CONFIG.portalUrgencyTime;
      const hz = 4 + urgency * 10;
      alpha *= 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time * hz * TAU));
    }

    // Inner ring asks the color; golden outer ring promises the prize.
    this.ring(ctx, p.x, p.y, r, p.color, 2.6, alpha);
    this.ring(ctx, p.x, p.y, r + 9, gold, 1.6, alpha * 0.85);

    // Shrinking golden arc = time left.
    const frac = clamp(p.timeLeft / p.duration, 0, 1);
    if (frac > 0 && scale > 0.9) {
      const start = -Math.PI / 2;
      this.ring(ctx, p.x, p.y, r + 16, gold, 1.4, 0.8, start, start + TAU * frac);
    }

    // Orbiting golden sparkles.
    const sparkles = this.q === 0 ? 4 : 2;
    for (let i = 0; i < sparkles; i++) {
      const a = p.rotation * 2 + (i * TAU) / sparkles;
      const sx = p.x + Math.cos(a) * (r + 13);
      const sy = p.y + Math.sin(a) * (r + 13);
      const tw = 0.5 + 0.5 * Math.sin(time * 6 + i * 2.1);
      this.glow(ctx, sx, sy, 1.4 + tw, gold, 0.5 + 0.5 * tw);
    }

    // "BONUS" tag under the ring.
    if (scale > 0.85) {
      ctx.globalAlpha = alpha * (0.75 + 0.25 * Math.sin(time * 3));
      ctx.fillStyle = gold;
      ctx.font = `800 11px 'Oxanium', ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('B O N U S', p.x, p.y + r + 24);
      ctx.globalAlpha = 1;
    }

    if (p.rejectFlash > 0) {
      this.ring(ctx, p.x, p.y, r + 4, '#9a9a9a', 3, p.rejectFlash);
    }
  }

  /**
   * The pip thief: a jittering, irregular red ring with a dim core and
   * orbiting shards — deliberately "wrong" against the clean neon dots.
   */
  private drawHazard(ctx: CanvasRenderingContext2D, hz: Hazard, time: number): void {
    const color = '#ff2975';
    const r = CONFIG.hazardRadius;

    let alpha = 0.9;
    if (hz.state === 'spawning') {
      // Flicker-in telegraph: harmless, unmistakable.
      const t = 1 - hz.stateT / CONFIG.hazardSpawnTelegraph;
      alpha = t * (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(time * 26 + hz.phase)));
    } else if (hz.state === 'despawning') {
      // Raid over: the spawn flicker in reverse — "you survived it".
      const t = hz.stateT / CONFIG.hazardDespawnTime;
      alpha = t * (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(time * 26 + hz.phase)));
    } else if (hz.state === 'fleeing') {
      alpha = 0.55 + 0.35 * Math.sin(time * 18);
    }

    // Irregular ring: short jittery arc segments instead of a clean circle.
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const a0 = hz.phase * 0.9 + (i * TAU) / 5 + Math.sin(hz.phase * 3 + i * 2.1) * 0.25;
      const jr = r + Math.sin(hz.phase * 5 + i * 1.7) * 2.2;
      ctx.globalAlpha = alpha * 0.85;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(hz.x, hz.y, jr, a0, a0 + 0.85);
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.25;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(hz.x, hz.y, jr, a0, a0 + 0.85);
      ctx.stroke();
    }

    // Dim, hungry core.
    this.glow(ctx, hz.x, hz.y, r * 0.34, color, alpha * 0.5);

    // Orbiting shards.
    for (let i = 0; i < 3; i++) {
      const a = -hz.phase * 1.5 + (i * TAU) / 3;
      const sx = hz.x + Math.cos(a) * (r + 7);
      const sy = hz.y + Math.sin(a) * (r + 7);
      this.glow(ctx, sx, sy, 1.4, color, alpha * (0.4 + 0.5 * Math.sin(time * 9 + i * 2)));
    }
    ctx.globalAlpha = 1;
  }

  private drawDrag(ctx: CanvasRenderingContext2D, s: Scene): void {
    if (!s.drag) return;
    const { dx, dy } = s.drag;
    const len = Math.hypot(dx, dy);
    if (len < 10) return;
    const k = Math.min(len, CONFIG.swipeMaxDrag) / len;
    const ex = s.orb.x + dx * k * 0.9;
    const ey = s.orb.y + dy * k * 0.9;
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(s.orb.x, s.orb.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    this.glow(ctx, ex, ey, 3, '#ffffff', 0.5);
  }

  private drawOrb(ctx: CanvasRenderingContext2D, s: Scene): void {
    const orb = s.orb;
    const inst = s.instability;
    const r = orbRadius(orb);

    // Instability jitter is render-space only.
    const jitter = inst * inst * 5;
    const x = orb.x + (Math.random() * 2 - 1) * jitter;
    const y = orb.y + (Math.random() * 2 - 1) * jitter;

    // Idle pulse +-4% + eat bounce, glow flicker at high instability.
    const pulse = 1 + 0.04 * Math.sin(s.time * 2.2);
    const scale = pulse * (1 + orb.bounceScale * 0.15);
    let glowAlpha = 1;
    if (inst > 0.4) {
      glowAlpha = 1 - (inst - 0.4) * 0.6 * Math.random();
    }

    const spr = this.sprite(orb.color);
    const hr = r * scale;
    ctx.globalAlpha = 0.35 * glowAlpha;
    ctx.drawImage(spr, x - hr * 3, y - hr * 3, hr * 6, hr * 6);
    ctx.globalAlpha = 0.55 * glowAlpha;
    ctx.drawImage(spr, x - hr * 1.7, y - hr * 1.7, hr * 3.4, hr * 3.4);
    ctx.globalAlpha = 1;

    // Core with squash-and-stretch.
    const sq = orb.squashT * 0.28;
    ctx.fillStyle = orb.color;
    ctx.beginPath();
    ctx.ellipse(x, y, hr * (1 - sq), hr * (1 + sq), orb.squashAngle, 0, TAU);
    ctx.fill();
    // Hot white center.
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, hr * 0.42, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Orbiting pips (last 3 colors eaten).
    const pipR = Math.max(3.4, r * 0.16);
    for (let i = 0; i < orb.pips.length; i++) {
      // Prism boost widens the ring to 4 slots; spacing tracks it live.
      const a = s.time * 2.4 + (i * TAU) / (CONFIG.pipCount + runMods.pipBonus);
      const px = x + Math.cos(a) * (hr + pipR + 6);
      const py = y + Math.sin(a) * (hr + pipR + 6);
      this.glow(ctx, px, py, pipR, orb.pips[i]);
    }
    // Learner run: a soft breathing ring around the pip orbit anchors the
    // coach's "these dots are your catches" line to the thing it describes.
    if (s.ftueGuide && orb.pips.length > 0) {
      const breathe = 0.25 + 0.2 * Math.sin(s.time * 2.2);
      this.ring(ctx, x, y, hr + pipR * 2 + 8, '#ffffff', 1.2, breathe);
    }

    // Instability meter: thin arc around the orb itself.
    if (inst > 0.01) {
      const color = inst > 0.75 ? '#ff2975' : inst > 0.4 ? '#ffd500' : '#ffffff';
      const start = -Math.PI / 2;
      const flick = inst > 0.6 ? 0.7 + 0.3 * Math.random() : 1;
      this.ring(ctx, x, y, hr + pipR * 2 + 12, color, 1.4, 0.9 * flick, start, start + TAU * inst);
    }

    // Self-teaching hazard feedback — the orb explains the thief itself.
    // Proximity: red rim flicker scaling with how close a hunting thief is.
    let danger = 0;
    for (const hz of s.hazards) {
      if (hz.state !== 'hunting') continue;
      const d = Math.hypot(hz.x - orb.x, hz.y - orb.y);
      danger = Math.max(danger, clamp(1 - d / 110, 0, 1));
    }
    if (danger > 0.01) {
      const flicker = 0.5 + 0.5 * Math.sin(s.time * 21);
      this.ring(ctx, x, y, hr + 4, '#ff2975', 2, danger * (0.35 + 0.65 * flicker));
    }
    // Steal hit: the whole orb flashes/flickers red. "Oops, bad orb."
    if (orb.stolenFlash > 0.01) {
      const fl = orb.stolenFlash * (0.55 + 0.45 * Math.sin(s.time * 30));
      ctx.globalAlpha = fl * 0.8;
      ctx.fillStyle = '#ff2975';
      ctx.beginPath();
      ctx.arc(x, y, hr * 1.05, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      this.ring(ctx, x, y, hr + 6, '#ff2975', 2.5, fl);
    }
  }

  private drawEffects(ctx: CanvasRenderingContext2D, fx: Effects): void {
    for (const sp of fx.sparks) {
      const a = clamp(sp.life / sp.maxLife, 0, 1);
      if (a < 0.02) continue;
      this.glow(ctx, sp.x, sp.y, sp.size, sp.color, a);
    }
    for (const w of fx.shocks) {
      const a = clamp(w.life / w.maxLife, 0, 1);
      if (a < 0.02) continue;
      this.ring(ctx, w.x, w.y, w.r, w.color, w.width * a, a);
    }
    for (const t of fx.texts) {
      const a = clamp(t.life / t.maxLife, 0, 1);
      ctx.font = `700 ${t.size}px 'Oxanium', ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.globalAlpha = a * 0.4;
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y + 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}
