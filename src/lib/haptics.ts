/**
 * Tiny vibration wrapper (pure TS, mirrors audio.setMuted). No-ops where
 * the Vibration API is unavailable (iOS Safari) or haptics are disabled.
 */
class Haptics {
  private enabled = true;

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  private vibrate(pattern: number | number[]): void {
    if (!this.enabled) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  }

  /** Light tick: portal expiry, small UI moments. */
  tap(): void {
    this.vibrate(15);
  }

  /** Delivery: scales with the celebration tier (0..3). */
  success(tier: number): void {
    if (tier <= 0) this.vibrate(20);
    else if (tier === 1) this.vibrate([25, 40, 25]);
    else if (tier === 2) this.vibrate([35, 50, 35, 50, 35]);
    else this.vibrate([50, 60, 50, 60, 90]);
  }

  /** Overload / collapse: one heavy thud. */
  heavy(): void {
    this.vibrate(120);
  }
}

export const haptics = new Haptics();
