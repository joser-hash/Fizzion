/**
 * Pointer (touch + mouse) input: drag anywhere on the canvas; on release
 * the drag vector becomes a directional impulse on the orb.
 */
export class InputController {
  private canvas: HTMLCanvasElement | null = null;
  private onImpulse: (dx: number, dy: number) => void = () => {};
  private onGesture: () => void = () => {};
  private pointerId: number | null = null;

  dragging = false;
  sx = 0;
  sy = 0;
  cx = 0;
  cy = 0;

  attach(
    canvas: HTMLCanvasElement,
    onImpulse: (dx: number, dy: number) => void,
    onGesture: () => void,
  ): void {
    this.canvas = canvas;
    this.onImpulse = onImpulse;
    this.onGesture = onGesture;
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.cancel);
  }

  detach(): void {
    const c = this.canvas;
    if (!c) return;
    c.removeEventListener('pointerdown', this.down);
    c.removeEventListener('pointermove', this.move);
    c.removeEventListener('pointerup', this.up);
    c.removeEventListener('pointercancel', this.cancel);
    this.canvas = null;
  }

  /** Current drag vector, or null when not dragging. */
  get drag(): { x: number; y: number; dx: number; dy: number } | null {
    if (!this.dragging) return null;
    return { x: this.sx, y: this.sy, dx: this.cx - this.sx, dy: this.cy - this.sy };
  }

  private down = (e: PointerEvent): void => {
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.canvas?.setPointerCapture(e.pointerId);
    this.dragging = true;
    this.sx = this.cx = e.clientX;
    this.sy = this.cy = e.clientY;
    this.onGesture();
  };

  private move = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.cx = e.clientX;
    this.cy = e.clientY;
  };

  private up = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.sx;
    const dy = e.clientY - this.sy;
    this.reset();
    if (Math.hypot(dx, dy) > 8) this.onImpulse(dx, dy);
  };

  private cancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.reset();
  };

  private reset(): void {
    this.pointerId = null;
    this.dragging = false;
  }
}
