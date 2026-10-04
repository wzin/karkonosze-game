import type { DestroyOptions, FederatedPointerEvent } from 'pixi.js';
import { Button, type ButtonOpts } from './Button';

/**
 * A Button held down for as long as the finger stays on the screen ("Dmuchaj"). The hold starts on
 * pointerdown and ends on pointerup anywhere, pointerupoutside, pointercancel (Pixi's or the
 * browser's, which Pixi does not forward), when the window loses focus, or when the button is
 * disabled. Sliding off the button keeps holding: the pointer is captured to the canvas.
 */
export class HoldButton extends Button {
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  private holdPointer: number | null = null;
  private captured: { el: Element; id: number } | null = null;
  private readonly onBlur = () => this.release();
  private readonly onNativeCancel = (e: PointerEvent) => {
    if (e.pointerId === this.holdPointer) this.release();
  };

  constructor(label: string, opts?: ButtonOpts) {
    super(label, opts);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('pointercancel', this.onNativeCancel, true);
  }

  get holding(): boolean {
    return this.holdPointer !== null;
  }

  /** Destroying is not a release: onHoldEnd does not fire, so it cannot reach a scene being torn down. */
  override destroy(options?: DestroyOptions): void {
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointercancel', this.onNativeCancel, true);
    this.onHoldStart = undefined;
    this.onHoldEnd = undefined;
    this.release();
    super.destroy(options);
  }

  protected override pressStart(e: FederatedPointerEvent): boolean {
    // a second finger (or a hold whose release got lost) ends the old hold before starting anew
    if (this.holding) this.release();
    if (!super.pressStart(e)) return false;
    this.holdPointer = e.pointerId;
    this.capture(e);
    this.onHoldStart?.();
    return true;
  }

  protected override release(): void {
    super.release();
    if (this.holdPointer === null) return;
    this.holdPointer = null;
    this.releaseCapture();
    this.onHoldEnd?.();
  }

  private capture(e: FederatedPointerEvent): void {
    const native = e.nativeEvent;
    const el = native.target;
    if (!(el instanceof Element) || !('pointerId' in native)) return;
    try {
      el.setPointerCapture(native.pointerId);
      this.captured = { el, id: native.pointerId };
    } catch {
      // the pointer is already gone; its pointerup / pointercancel still ends the hold
    }
  }

  private releaseCapture(): void {
    const c = this.captured;
    this.captured = null;
    if (!c) return;
    try {
      if (c.el.hasPointerCapture(c.id)) c.el.releasePointerCapture(c.id);
    } catch {
      // nothing to release
    }
  }
}
