import { CONFIG, GAME_COLORS, type GameColor } from '../constants';
import { haptics } from '../haptics';
import { upgradeEffects } from '../upgrades';
import { clamp, dist, lerp } from './utils';
import { audio } from './audio';
import { Effects } from './effects';
import {
  applyImpulse,
  createOrb,
  majorityColor,
  orbRadius,
  updateOrb,
  type Orb,
} from './orb';
import {
  beginAttracts,
  foodCount,
  scatterOverload,
  spawnCluster,
  updateParticles,
  type FoodParticle,
} from './particles';
import {
  createPortal,
  layoutPortal,
  pickRelocationSpot,
  rerollPortal,
  updatePortal,
  type Portal,
  type RequestType,
} from './portal';
import { spawnHazard, updateHazard, type Hazard } from './hazard';
import { InputController } from './input';
import { Renderer } from './render';

export type EnginePhase = 'idle' | 'playing' | 'ended';

export interface RoundStats {
  score: number;
  bestChain: number;
  sparksEarned: number;
  deliveries: number;
  overloads: number;
  /** Seconds the run survived. */
  duration: number;
}

export interface HudSnapshot {
  score: number;
  chain: number;
  /** Seconds until the chain breaks without a delivery (0 when no chain). */
  chainTimeLeft: number;
  /** Elapsed run time in seconds (endless mode counts up). */
  runTime: number;
  /** Run life bar 0..1; the run ends when it reaches 0. */
  stability: number;
  /** Decaying mass accumulator from recent deliveries. */
  comboHeat: number;
  instability: number;
  colorLockLeft: number;
  /** Pips the orb currently carries (FTUE coach watches this). */
  pips: number;
  /** Successful deliveries this run (FTUE coach watches this). */
  deliveries: number;
  /** Overloads this run (FTUE coach explains the first pop reactively). */
  overloads: number;
  /** Current portal request (request coach teaches each label once). */
  requestType: RequestType;
  requestMinMass: number;
}

export interface EngineCallbacks {
  /** Throttled (~10Hz) state sync for React HUD logic. */
  onSync(snap: HudSnapshot): void;
  onRoundEnd(stats: RoundStats): void;
  /**
   * Stability hit zero but a revive is still available. The engine freezes
   * ('ended') until either revive() or abandonRevive() is called.
   */
  onCollapse(stats: RoundStats): void;
  onChainBreak(): void;
}

/**
 * The whole simulation lives here, outside React, driven by rAF with
 * clamped delta time. React talks to it through the command methods.
 */
class Engine {
  phase: EnginePhase = 'idle';

  /** Per-frame values the HUD reads via its own rAF (never re-renders React). */
  readonly hud = {
    displayScore: 0,
    score: 0,
    chain: 0,
    chainTimeLeft: 0,
    runTime: 0,
    stability: 1,
    comboHeat: 0,
    instability: 0,
    colorLockLeft: 0,
    fps: 60,
  };

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private cb: EngineCallbacks | null = null;
  private w = 0;
  private h = 0;

  private orb: Orb = createOrb(0, 0);
  private particles: FoodParticle[] = [];
  private portal: Portal = createPortal();
  private hazards: Hazard[] = [];
  /** Seconds until the next raid; only ticks while no hazards are active. */
  private hazardCooldown = 0;
  private effects = new Effects();
  private input = new InputController();
  private renderer = new Renderer();

  private score = 0;
  private chain = 0;
  private chainTimeLeft = 0;
  private bestChainRound = 0;
  private sparksEarned = 0;
  private deliveries = 0;
  private deliveriesSinceRelocate = 0;
  /** FTUE color ramp: colors unlock with deliveries until completed once. */
  private colorRampActive = false;
  private overloads = 0;
  private runTime = 0;
  private stability = 1;
  private comboHeat = 0;
  private warnAcc = 0;
  private reviveUsed = false;

  private paused = false;
  private hitStopLeft = 0;
  private pendingDelivery: {
    gained: number;
    sparks: number;
    chain: number;
    tier: number;
    intensity: number;
  } | null = null;
  private time = 0;
  private lastFrame = 0;
  private raf = 0;
  private syncAcc = 0;
  private spawnAcc = 0;

  // Quality governor: 0 = full, 1 = reduced, 2 = low.
  quality = 0;
  /** Set by a manual override (debug panel): the governor stands down. */
  qualityLocked = false;
  private fpsEma = 60;
  private lowFpsAcc = 0;
  private highFpsAcc = 0;

  // ---- lifecycle -------------------------------------------------------

  init(canvas: HTMLCanvasElement, cb: EngineCallbacks): void {
    this.canvas = canvas;
    // Opaque canvas: we paint a full black background every frame anyway,
    // and opaque surfaces composite cheaper (desynchronized cuts latency
    // where supported).
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.cb = cb;
    this.loadQuality();
    this.input.attach(
      canvas,
      (dx, dy) => {
        if (this.phase === 'playing' && !this.paused) applyImpulse(this.orb, dx, dy);
      },
      () => audio.unlock(),
    );
    this.resize();
    this.orb = createOrb(this.w / 2, this.h / 2);
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.input.detach();
    this.canvas = null;
    this.ctx = null;
    this.cb = null;
  }

  resize(): void {
    const c = this.canvas;
    if (!c) return;
    const dpr =
      Math.min(window.devicePixelRatio || 1, 2) *
      (CONFIG.qualityRenderScale[this.quality] ?? 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    c.width = Math.round(this.w * dpr);
    c.height = Math.round(this.h * dpr);
    c.style.width = `${this.w}px`;
    c.style.height = `${this.h}px`;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    layoutPortal(this.portal, this.w, this.h);
  }

  // ---- quality governor ------------------------------------------------

  private loadQuality(): void {
    const raw = Number(localStorage.getItem('fizzion_quality'));
    if (raw === 1 || raw === 2) this.quality = raw;
    this.applyQuality();
  }

  /** Set a tier (governor or manual override) and apply all its knobs. */
  setQuality(tier: number, locked = this.qualityLocked): void {
    this.quality = Math.max(0, Math.min(CONFIG.qualityRenderScale.length - 1, tier));
    this.qualityLocked = locked;
    this.lowFpsAcc = 0;
    this.highFpsAcc = 0;
    localStorage.setItem('fizzion_quality', String(this.quality));
    this.applyQuality();
    this.resize();
  }

  private applyQuality(): void {
    this.effects.sparkCap = CONFIG.qualitySparkCap[this.quality] ?? 220;
    this.effects.sparkScale = CONFIG.qualitySparkScale[this.quality] ?? 1;
  }

  /**
   * Frame-time EMA + hysteresis: shed load fast when the device struggles,
   * climb back slowly and only during real play so it never oscillates.
   */
  private updateGovernor(rawMs: number): void {
    if (rawMs <= 0 || rawMs > 250) return; // tab switch / resume outlier
    this.fpsEma += (1000 / rawMs - this.fpsEma) * 0.05;
    this.hud.fps = this.fpsEma;
    if (this.qualityLocked || this.paused || this.phase !== 'playing') return;

    const dt = rawMs / 1000;
    if (this.fpsEma < CONFIG.qualityStepDownFps) {
      this.lowFpsAcc += dt;
      this.highFpsAcc = 0;
      if (
        this.lowFpsAcc >= CONFIG.qualityStepDownAfter &&
        this.quality < CONFIG.qualityRenderScale.length - 1
      ) {
        this.setQuality(this.quality + 1);
      }
    } else if (this.fpsEma > CONFIG.qualityStepUpFps) {
      this.highFpsAcc += dt;
      this.lowFpsAcc = 0;
      if (this.highFpsAcc >= CONFIG.qualityStepUpAfter && this.quality > 0) {
        this.setQuality(this.quality - 1);
      }
    } else {
      this.lowFpsAcc = 0;
      this.highFpsAcc = 0;
    }
  }

  // ---- commands (UI -> engine) ----------------------------------------

  startRound(opts?: { colorRamp?: boolean }): void {
    this.colorRampActive = opts?.colorRamp ?? false;
    this.orb = createOrb(this.w / 2, this.h / 2);
    this.particles = [];
    this.hazards = [];
    this.hazardCooldown = 0; // first raid lands right at the ramp gate
    this.effects.clear();
    this.portal = createPortal();
    layoutPortal(this.portal, this.w, this.h);
    // Learner stage 1: the portal's first request comes from the reduced
    // starting palette (createPortal picks from all four).
    if (this.colorRampActive) {
      const ac = this.activeColors;
      this.portal.color = ac[Math.floor(Math.random() * ac.length)];
    }
    this.score = 0;
    this.chain = 0;
    this.chainTimeLeft = 0;
    this.bestChainRound = 0;
    this.sparksEarned = 0;
    this.deliveries = 0;
    this.deliveriesSinceRelocate = 0;
    this.overloads = 0;
    this.runTime = 0;
    this.stability = 1;
    this.comboHeat = 0;
    this.warnAcc = 0;
    this.reviveUsed = false;
    this.hud.displayScore = 0;
    this.pendingDelivery = null;
    this.hitStopLeft = 0;
    this.paused = false;
    while (foodCount(this.particles) < CONFIG.maxParticles - CONFIG.clusterMax) {
      spawnCluster(
        this.particles,
        this.w,
        this.h,
        this.portal.x,
        this.portal.y,
        this.orb,
        this.activeColors,
      );
    }
    this.phase = 'playing';
    this.sync(true);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.lastFrame = performance.now();
  }

  /** Rewarded "Stabilize": reset instability to the configured fraction. */
  applyStabilize(): void {
    const span = this.effectiveOverloadMass - CONFIG.instabilityStartMass;
    this.orb.mass = Math.max(1, Math.round(CONFIG.instabilityStartMass + CONFIG.stabilizeResetTo * span));
    this.effects.shockwave(this.orb.x, this.orb.y, '#ffffff', orbRadius(this.orb) * 2.5, 4);
  }

  /** Rewarded "Color Lock": freeze the portal request timer. */
  activateColorLock(): void {
    if (this.phase !== 'playing') return;
    this.portal.lockLeft = CONFIG.colorLockDuration;
  }

  /** Overload threshold including the Dense Shell upgrade. */
  private get effectiveOverloadMass(): number {
    return CONFIG.overloadMass + upgradeEffects.overloadBonus;
  }

  get instability(): number {
    const span = this.effectiveOverloadMass - CONFIG.instabilityStartMass;
    return clamp((this.orb.mass - CONFIG.instabilityStartMass) / span, 0, 1);
  }

  /** Difficulty ramp 0..1 over the configured ramp duration. */
  get difficulty(): number {
    return clamp(this.runTime / CONFIG.rampDuration, 0, 1);
  }

  /**
   * Colors currently in play. Outside the FTUE ramp this is the full
   * palette; on learner runs colors unlock one by one as deliveries land.
   */
  get activeColors(): readonly GameColor[] {
    if (!this.colorRampActive) return GAME_COLORS;
    let n = CONFIG.colorRampStartColors;
    for (const t of CONFIG.colorRampUnlocks) if (this.deliveries >= t) n++;
    return GAME_COLORS.slice(0, n);
  }

  // ---- loop ------------------------------------------------------------

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const rawMs = now - this.lastFrame;
    this.lastFrame = now;
    this.updateGovernor(rawMs);
    let dt = clamp(rawMs, 0, CONFIG.maxDeltaMs) / 1000;
    this.time += dt;

    if (this.hitStopLeft > 0) {
      this.hitStopLeft -= rawMs;
      if (this.hitStopLeft <= 0 && this.pendingDelivery) this.celebrateDelivery();
      dt = 0; // freeze-frame
    }

    if (!this.paused && dt > 0) {
      if (this.phase === 'playing') {
        this.update(dt);
      } else {
        // Ambient: keep the menu background alive; 'ended' stays frozen
        // apart from pulses so the results screen sits over a still scene.
        if (this.phase === 'idle') updateOrb(this.orb, dt, this.w, this.h, this.effects);
        updateParticles(this.particles, dt, this.orb, this.w, this.h);
        this.effects.update(dt);
      }
    }

    // Smooth score count-up, even during hit-stop.
    const gap = this.score - this.hud.displayScore;
    const rate = Math.min(1, 6 * (dt > 0 ? dt : 0.016));
    this.hud.displayScore = Math.abs(gap) < 0.5 ? this.score : this.hud.displayScore + gap * rate;

    if (this.ctx) {
      this.renderer.render(
        this.ctx,
        {
          orb: this.orb,
          particles: this.particles,
          portal: this.portal,
          hazards: this.hazards,
          effects: this.effects,
          instability: this.instability,
          stability: this.stability,
          heat: Math.min(1, this.comboHeat / CONFIG.comboHeatFull),
          playing: this.phase === 'playing',
          quality: this.quality,
          time: this.time,
          drag: this.phase === 'playing' && !this.paused ? this.input.drag : null,
          ftueGuide: this.colorRampActive && this.deliveries === 0,
        },
        this.w,
        this.h,
      );
    }
  };

  /**
   * Hazards are raids, not residents: once the ramp gate passes, a raid of
   * 1-2 thieves spawns, each lives out its window and flickers away, and a
   * cooldown (ticking only between raids) schedules the next one.
   */
  private updateHazards(dt: number): void {
    const raidSize = Math.min(
      CONFIG.hazardMaxCount,
      this.difficulty >= CONFIG.hazardSecondAt ? 2 : 1,
    );
    if (this.hazards.length === 0 && raidSize > 0 && this.difficulty >= CONFIG.hazardRampStart) {
      this.hazardCooldown -= dt;
      if (this.hazardCooldown <= 0) {
        for (let i = 0; i < raidSize; i++) {
          this.hazards.push(spawnHazard(this.orb, this.w, this.h, this.difficulty));
        }
        this.hazardCooldown = lerp(
          CONFIG.hazardCooldownMax,
          CONFIG.hazardCooldownMin,
          this.difficulty,
        );
      }
    }

    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const hz = this.hazards[i];
      const hit = updateHazard(hz, dt, this.orb, this.w, this.h);
      if (hit.stole) {
        this.effects.text(this.orb.x, this.orb.y - orbRadius(this.orb) - 18, 'STOLEN', '#ff2975', 15);
        this.effects.burst(hz.x, hz.y, '#ff2975', 6, 180);
        this.effects.shake(CONFIG.shakeSmall * 0.8, CONFIG.shakeSmallMs);
        audio.crackle(0.9);
        haptics.tap();
        this.sync(true);
      } else if (hit.bounced) {
        audio.crackle(0.35);
      }
      if (hit.expired) {
        // Survived the raid: dissipate into shards, a small relief beat.
        this.effects.burst(hz.x, hz.y, '#ff2975', 8, 140);
        this.hazards.splice(i, 1);
      }
    }
  }

  private update(dt: number): void {
    updateOrb(this.orb, dt, this.w, this.h, this.effects);

    beginAttracts(this.particles, this.orb);
    const consumed = updateParticles(this.particles, dt, this.orb, this.w, this.h);
    for (const p of consumed) this.consume(p);

    // Learner freeze: on FTUE-ramp runs the first request doesn't tick until
    // the player has caught a few drops — calm space to learn the controls
    // without a shrinking timer shouting pressure.
    if (this.colorRampActive && this.deliveries === 0 && this.orb.mass < 4) {
      this.portal.timeLeft = this.portal.duration;
    }
    const expired = updatePortal(this.portal, dt);
    if (this.portal.justRelocated) {
      this.portal.justRelocated = false;
      this.effects.shockwave(
        this.portal.x,
        this.portal.y,
        this.portal.color,
        CONFIG.portalRadius * 2.6,
        5,
        0.5,
      );
      this.effects.burst(this.portal.x, this.portal.y, this.portal.color, 14, 260);
    }
    if (expired) this.handlePortalExpiry();
    this.checkPortalContact();
    this.updateHazards(dt);

    // Top-up food clusters periodically.
    this.spawnAcc += dt;
    if (this.spawnAcc > 0.4) {
      this.spawnAcc = 0;
      if (foodCount(this.particles) <= CONFIG.maxParticles - CONFIG.clusterMin) {
        spawnCluster(
          this.particles,
          this.w,
          this.h,
          this.portal.x,
          this.portal.y,
          this.orb,
          this.activeColors,
        );
      }
    }

    // Instability ambience: spark bleed + crackle.
    const inst = this.instability;
    if (inst > 0.15) {
      if (Math.random() < inst * dt * 22) {
        this.effects.burst(this.orb.x, this.orb.y, this.orb.color, 1, 120 + inst * 160);
      }
      if (Math.random() < inst * dt * 9) audio.crackle(inst);
    }

    this.effects.update(dt);

    this.runTime += dt;
    this.comboHeat *= Math.pow(0.5, dt / CONFIG.comboHeatHalfLife);
    if (this.comboHeat < 0.05) this.comboHeat = 0;

    // The chain is a streak: it expires without a fresh delivery.
    if (this.chain > 0) {
      this.chainTimeLeft -= dt;
      if (this.chainTimeLeft <= 0) {
        this.chain = 0;
        this.chainTimeLeft = 0;
        this.cb?.onChainBreak();
      }
    }

    // Low-stability heartbeat.
    if (this.stability < CONFIG.stabilityWarnAt) {
      this.warnAcc += dt;
      const interval = 0.55 + this.stability;
      if (this.warnAcc >= interval) {
        this.warnAcc = 0;
        audio.warn();
      }
    }

    if (this.stability <= 0) {
      this.endRound();
      return;
    }

    this.syncAcc += dt;
    if (this.syncAcc >= 1 / CONFIG.storeUpdateHz) {
      this.syncAcc = 0;
      this.sync();
    }
  }

  // ---- gameplay events ---------------------------------------------------

  private consume(p: FoodParticle): void {
    const orb = this.orb;
    orb.mass += 1;
    orb.bounceScale = 1;

    orb.pips.push(p.color);
    while (orb.pips.length > CONFIG.pipCount) orb.pips.shift();
    const prevColor = orb.color;
    orb.color = majorityColor(orb.pips, prevColor);

    if (p.color === orb.color) orb.streak += 1;
    else orb.streak = 0;
    audio.pop(orb.streak);

    this.effects.burst(p.x, p.y, p.color, 5 + Math.floor(Math.random() * 4), 160);

    if (orb.color !== prevColor) {
      // Color shift: radial ring pulse + 5% screen flash in the new color.
      this.effects.shockwave(orb.x, orb.y, orb.color, orbRadius(orb) * 3, 3.5, 0.4);
      this.effects.flash(orb.color, 0.05);
    }

    if (orb.mass >= this.effectiveOverloadMass) this.overload();
  }

  private overload(): void {
    const orb = this.orb;
    const x = orb.x;
    const y = orb.y;
    const mass = orb.mass;

    audio.boom();
    haptics.heavy();
    this.effects.shake(CONFIG.shakeBig, CONFIG.shakeBigMs);
    this.effects.shockwave(x, y, '#ffffff', Math.max(this.w, this.h) * 0.55, 8, 0.7);
    this.effects.shockwave(x, y, orb.color, Math.max(this.w, this.h) * 0.35, 6, 0.55);
    this.effects.burst(x, y, orb.color, 26, 420);
    this.effects.flash('#ffffff', 0.14);

    // Overload punishes the run slightly and cools the combo.
    this.stability = Math.max(0, this.stability - CONFIG.stabilityDrainOverload);
    this.comboHeat *= 0.5;

    // Scatter mass as collectible particles, colored by pips weighted by majority.
    const weighted: GameColor[] = [...orb.pips];
    const majority = orb.pips.find((c) => c === orb.color);
    if (majority) weighted.push(majority, majority);
    if (weighted.length === 0) weighted.push('#00ff88');
    scatterOverload(this.particles, x, y, mass, weighted);

    this.overloads += 1;
    if (this.chain > 0) {
      this.chain = 0;
      this.chainTimeLeft = 0;
      this.cb?.onChainBreak();
    }

    // Respawn instantly at the explosion point at mass 1, empty pips.
    const fresh = createOrb(x, y);
    fresh.color = '#ffffff';
    this.orb = fresh;
    this.sync(true);
  }

  private checkPortalContact(): void {
    const p = this.portal;
    if (p.rerollLeft > 0) return;
    const d = dist(this.orb.x, this.orb.y, p.x, p.y);
    const touching = d < orbRadius(this.orb) + CONFIG.portalRadius * 0.9;

    if (!touching) {
      if (d > orbRadius(this.orb) + CONFIG.portalRadius + 14) p.contact = false;
      return;
    }
    if (p.contact) return;
    p.contact = true;

    let eligible: boolean;
    if (p.requestType === 'pure') {
      // Pure: every pip must be the request color, not just the majority.
      eligible =
        this.orb.pips.length === CONFIG.pipCount &&
        this.orb.pips.every((c) => c === p.color);
    } else {
      const colorMatch = this.orb.pips.length > 0 && this.orb.color === p.color;
      eligible = colorMatch && this.orb.mass >= p.minMass;
    }
    if (eligible) {
      this.deliver();
    } else {
      // Soft rejection: bounce back, dull thud, gray flash. Never punish.
      const nx = (this.orb.x - p.x) / (d || 1);
      const ny = (this.orb.y - p.y) / (d || 1);
      const speed = Math.max(Math.hypot(this.orb.vx, this.orb.vy), 220);
      this.orb.vx = nx * speed * 0.75;
      this.orb.vy = ny * speed * 0.75;
      p.rejectFlash = 1;
      audio.thud();
    }
  }

  /** Celebration tier from delivered mass: 0 normal, 1 BIG, 2 HUGE, 3 COLOSSAL. */
  private deliveryTier(mass: number): number {
    const t = CONFIG.deliveryTierMasses;
    let tier = 0;
    for (let i = 0; i < t.length; i++) if (mass >= t[i]) tier = i + 1;
    return tier;
  }

  private deliver(): void {
    this.chain += 1;
    this.chainTimeLeft = CONFIG.chainWindow;
    this.bestChainRound = Math.max(this.bestChainRound, this.chain);
    const mult = this.chain;
    const mass = this.orb.mass;
    const type = this.portal.requestType;
    const typeMult =
      type === 'rush' ? CONFIG.rushScoreMult : type === 'pure' ? CONFIG.pureScoreMult : 1;
    const gained = Math.round(mass * CONFIG.scorePerMass * mult * typeMult);
    const sparks = Math.ceil((mass * mult) / CONFIG.sparksDivisor);
    this.score += gained;
    this.sparksEarned += sparks;
    this.deliveries += 1;

    // Deliveries repair the portal; chains repair a little extra, pure a lot.
    const restoreMult = type === 'pure' ? CONFIG.pureRestoreMult : 1;
    this.stability = Math.min(
      1,
      this.stability +
        CONFIG.stabilityRestoreDelivery * restoreMult +
        (mult - 1) * CONFIG.stabilityChainBonus,
    );

    // Combo heat: recent delivered mass, decaying — quick heavy strings stack.
    this.comboHeat += mass;
    const heat01 = Math.min(1, this.comboHeat / CONFIG.comboHeatFull);

    const tier = this.deliveryTier(mass);
    // Hit-stop first (longer for bigger orbs); celebration fires when it elapses.
    this.pendingDelivery = { gained, sparks, chain: mult, tier, intensity: 1 + heat01 * 0.5 };
    this.hitStopLeft = CONFIG.deliveryTierHitStop[tier] ?? CONFIG.hitStopMs;
  }

  private celebrateDelivery(): void {
    const pd = this.pendingDelivery;
    if (!pd) return;
    this.pendingDelivery = null;
    const p = this.portal;
    const orb = this.orb;
    const { tier, intensity } = pd;

    audio.chime(pd.chain, tier);
    haptics.success(tier);
    const shakeScale = [1, 1.6, 2.4, 3.2][tier] ?? 1;
    this.effects.shake(
      CONFIG.shakeSmall * shakeScale * intensity,
      CONFIG.shakeSmallMs + tier * 60,
    );
    this.effects.jet(orb.x, orb.y, p.x, p.y, orb.color, Math.round(26 * (1 + tier * 0.5) * intensity));

    // Concentric shockwaves: more, bigger rings for bigger orbs.
    const rings = 1 + Math.min(tier, 2) + (tier >= 3 ? 1 : 0);
    for (let i = 0; i < rings; i++) {
      this.effects.shockwave(
        p.x,
        p.y,
        i % 2 === 0 ? p.color : '#ffffff',
        CONFIG.portalRadius * (3.2 + i * 1.4) * intensity,
        5 - i,
        0.5 + i * 0.12,
      );
    }

    const labels = ['', 'BIG!', 'HUGE!', 'COLOSSAL!'];
    const textY = p.y + CONFIG.portalRadius + 34;
    if (tier > 0) {
      this.effects.text(p.x, textY + 26 + tier * 4, labels[tier], p.color, 16 + tier * 5);
    }
    this.effects.text(p.x, textY, `+${pd.gained}`, p.color, 24 + tier * 6);
    if (tier >= 3) this.effects.flash(p.color, 0.08);
    p.successFlash = 1;

    // Orb consumed -> respawn at center, mass 1, empty pips.
    const fresh = createOrb(this.w / 2, this.h / 2);
    this.orb = fresh;

    // Relocation: earned by deliveries, gated so the learning window keeps
    // a stable target; cadence tightens with difficulty. Expiry rerolls
    // never move the portal (no double punishment).
    this.deliveriesSinceRelocate += 1;
    const cadence = Math.round(
      CONFIG.relocateEveryMax +
        (CONFIG.relocateEveryMin - CONFIG.relocateEveryMax) * this.difficulty,
    );
    if (
      this.runTime >= CONFIG.relocateMinTime &&
      this.deliveries >= CONFIG.relocateMinDeliveries &&
      this.deliveriesSinceRelocate >= cadence
    ) {
      this.deliveriesSinceRelocate = 0;
      pickRelocationSpot(p, this.w, this.h, fresh.x, fresh.y);
    }

    // FTUE ramp: a delivery milestone brings a new color into play — make
    // the moment felt so the palette change reads as a reward, not a bug.
    if (
      this.colorRampActive &&
      (CONFIG.colorRampUnlocks as readonly number[]).includes(this.deliveries)
    ) {
      const colors = this.activeColors;
      const unlocked = colors[colors.length - 1];
      this.effects.text(this.w / 2, this.h * 0.42, 'NEW COLOR!', unlocked, 20);
      this.effects.flash(unlocked, 0.08);
      this.effects.shockwave(this.w / 2, this.h / 2, unlocked, Math.min(this.w, this.h) * 0.4, 3);
      // The unlock shockwave "converts" a handful of existing drops so the
      // new color is instantly collectible — the field is full at this
      // moment, so a fresh cluster would have no room to spawn.
      const idle = this.particles.filter(
        (q) => q.state === 'idle' && q.expireLife === undefined,
      );
      for (let i = 0; i < 5 && idle.length > 0; i++) {
        const drop = idle.splice(Math.floor(Math.random() * idle.length), 1)[0];
        drop.color = unlocked;
        this.effects.burst(drop.x, drop.y, unlocked, 3, 120);
      }
    }

    rerollPortal(p, this.difficulty, this.requestableColors());
    this.sync(true);
  }

  /**
   * Active colors that actually have food on the field, so the portal never
   * requests a color the player can't collect. Falls back to the full
   * active palette if the field is starved (e.g. everything mid-attract).
   */
  private requestableColors(): readonly GameColor[] {
    const counts = new Map<GameColor, number>();
    for (const q of this.particles) {
      if (q.state !== 'idle' || q.expireLife !== undefined) continue;
      counts.set(q.color, (counts.get(q.color) ?? 0) + 1);
    }
    const present = this.activeColors.filter((c) => (counts.get(c) ?? 0) >= 3);
    return present.length > 0 ? present : this.activeColors;
  }

  private handlePortalExpiry(): void {
    // Missed request: the portal destabilizes (softened by Reinforced Portal).
    // Learner grace: until the very first delivery of an FTUE-ramp run, the
    // portal isn't dangerous yet — reroll without draining stability.
    const grace = this.colorRampActive && this.deliveries === 0;
    if (!grace) {
      this.stability = Math.max(
        0,
        this.stability - CONFIG.stabilityDrainExpire * upgradeEffects.expireDrainMult,
      );
      this.effects.flash('#ff2975', 0.07);
      audio.thud();
      haptics.tap();
    }

    // Wasted match: expiring while the orb currently matches breaks the chain.
    const wasted = this.orb.pips.length > 0 && this.orb.color === this.portal.color;
    if (wasted && this.chain > 0) {
      this.chain = 0;
      this.chainTimeLeft = 0;
      this.cb?.onChainBreak();
    }
    this.sync(true);
    rerollPortal(this.portal, this.difficulty, this.requestableColors());
  }

  /** Rewarded "Second Chance": resume the collapsed run once per run. */
  revive(): void {
    if (this.phase !== 'ended' || this.reviveUsed) return;
    this.reviveUsed = true;
    this.stability = CONFIG.reviveStability;
    this.comboHeat = 0;
    this.chain = 0;
    this.chainTimeLeft = 0;
    // Fresh request, full window, and a fresh position — a real new start.
    this.hazards = [];
    this.hazardCooldown = CONFIG.hazardCooldownMin; // post-revive breathing room
    this.deliveriesSinceRelocate = 0;
    pickRelocationSpot(this.portal, this.w, this.h, this.orb.x, this.orb.y);
    rerollPortal(this.portal, this.difficulty, this.requestableColors());
    this.effects.flash('#00ff88', 0.12);
    this.effects.shockwave(this.portal.x, this.portal.y, '#00ff88', CONFIG.portalRadius * 3, 5);
    audio.chime(1);
    this.phase = 'playing';
    this.lastFrame = performance.now();
    this.sync(true);
  }

  /** Player declined the revive offer: finish the run for real. */
  abandonRevive(): void {
    if (this.phase !== 'ended') return;
    this.reviveUsed = true;
    this.cb?.onRoundEnd(this.roundStats());
  }

  private roundStats(): RoundStats {
    return {
      score: this.score,
      bestChain: this.bestChainRound,
      sparksEarned: this.sparksEarned,
      deliveries: this.deliveries,
      overloads: this.overloads,
      duration: this.runTime,
    };
  }

  private endRound(): void {
    this.phase = 'ended';
    this.sync(true);
    // Death is the revive moment: offer Second Chance once per run.
    if (!this.reviveUsed) {
      this.cb?.onCollapse(this.roundStats());
    } else {
      this.cb?.onRoundEnd(this.roundStats());
    }
  }

  private sync(force = false): void {
    this.hud.score = this.score;
    this.hud.chain = this.chain;
    this.hud.chainTimeLeft = this.chainTimeLeft;
    this.hud.runTime = this.runTime;
    this.hud.stability = this.stability;
    this.hud.comboHeat = this.comboHeat;
    this.hud.instability = this.instability;
    this.hud.colorLockLeft = this.portal.lockLeft;
    if (force) this.syncAcc = 0;
    this.cb?.onSync({
      score: this.score,
      chain: this.chain,
      chainTimeLeft: this.chainTimeLeft,
      runTime: this.runTime,
      stability: this.stability,
      comboHeat: this.comboHeat,
      instability: this.instability,
      colorLockLeft: this.portal.lockLeft,
      pips: this.orb.pips.length,
      deliveries: this.deliveries,
      overloads: this.overloads,
      requestType: this.portal.requestType,
      requestMinMass: this.portal.minMass,
    });
  }
}

export const engine = new Engine();
