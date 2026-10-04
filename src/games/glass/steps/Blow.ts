import { Graphics, Sprite } from 'pixi.js';
import { HoldButton } from '../../../ui/HoldButton';
import { Theme } from '../../../ui/Theme';
import { ease, softDotTexture } from '../fx';
import { BLOW, LIMITS, blowGrows, blowScore, grow, nextBlowState, popped, type BlowEvent, type BlowState } from '../rules';
import { dashedRing } from '../ui';
import { R0 } from '../Workpiece';
import { Step, type StepEnv } from './Step';

export interface BlowResult {
  score: number;
  r: number;
  pops: number;
}

/** Seconds from a burst to a fresh gather on the pipe (brief: 1.1 s). */
const RESET_AFTER = 1.1;
/** After the last allowed burst (or a time-out during one) the fresh gather shows this long, then the move ends. */
const CLOSE_AFTER = 0.4;
/** A tap shorter than this share of the way to the ring does not count as a release. */
const MIN_GROWTH = 0.25;

/**
 * Dmuchaj: hold to blow the bubble up to the dashed contour. Above 150 % it bursts (shards, sound,
 * fresh gather after 1.1 s, one retry with a penalty). Release scores blowScore(); 20 s limit.
 * The states and their transitions are rules.ts' nextBlowState(); only `blowing` grows the bubble.
 */
export class BlowStep extends Step {
  readonly kind = 'blow';
  private readonly target: number;
  private readonly ring = new Graphics();
  private button!: HoldButton;
  private state: BlowState = 'ready';
  private r = R0;
  private pops = 0;
  private ringLook = '';
  private age = 0;
  private puff = 0;
  private expired = false;
  private resolved = false;

  constructor(
    env: StepEnv,
    private readonly onDone: (res: BlowResult) => void,
  ) {
    super(env, LIMITS.blow);
    this.target = BLOW.target[env.order.size];
  }

  protected start(): void {
    const { t, piece, card, ctx } = this.env;
    card.set(t('glass.blow.h'), t('glass.blow.p'));
    this.r = piece.r;

    const c = piece.centreFor(this.target);
    this.ring.position.set(c.x, c.y);
    this.ring.alpha = 0;
    this.drawRing('idle');

    this.button = new HoldButton(t('glass.blow.btn'), { kiosk: ctx.kiosk, name: 'glass.blow.btn', width: 560 });
    this.button.position.set(960 - this.button.box.w / 2, 908);
    this.button.onHoldStart = () => this.holdStart();
    this.button.onHoldEnd = () => this.holdEnd();
    this.addChild(this.ring, this.button);
    this.tw.add(0.4, (p) => (this.ring.alpha = p));
  }

  override unmount(): void {
    this.env.ctx.audio.stop('glass.blow');
    this.env.piece.wobble = 0;
    super.unmount();
  }

  override debug(): Record<string, number | string> {
    return { r: this.r, target: this.target, pops: this.pops, state: this.state };
  }

  protected override timeUp(): void {
    this.expired = true;
    this.env.toast.show(this.env.t('glass.timeUp'));
    // ready / blowing end here with the current radius; a burst in progress (popped) or a closing
    // move ends once its fresh gather is back, scored from that gather, never from growth
    if (this.go('timeUp') === 'done') this.resolve();
  }

  private go(event: BlowEvent): BlowState {
    this.state = nextBlowState(this.state, event, { pops: this.pops, expired: this.expired });
    return this.state;
  }

  protected override tick(dt: number): void {
    this.age += dt;
    const piece = this.env.piece;
    this.ring.scale.set(1 + Math.sin(this.age * 4) * 0.008);
    if (!blowGrows(this.state)) return;

    this.r = grow(this.r, dt);
    piece.setRadius(this.r);
    this.updateRingLook();
    this.puff -= dt;
    if (this.puff <= 0) {
      this.puff = 0.06;
      this.heatShimmer();
    }
    if (popped(this.r, this.target)) this.burst();
  }

  private holdStart(): void {
    if (this.state !== 'ready' || this.go('hold') !== 'blowing') return;
    this.env.toast.hide();
    this.env.piece.wobble = 1;
    this.env.ctx.audio.play('glass.blow', { loop: true, volume: 0.8 });
  }

  private holdEnd(): void {
    if (this.state !== 'blowing') return;
    this.env.ctx.audio.stop('glass.blow');
    this.env.piece.wobble = 0;
    // a quick test tap (short of a quarter of the way to the ring) lets the player hold again
    const tap = this.r < R0 + (this.target - R0) * MIN_GROWTH && !this.expired;
    if (this.go(tap ? 'tap' : 'release') === 'done') this.resolve();
  }

  /** The move is over (state `done`): score the radius on the pipe and hand it on. */
  private resolve(): void {
    if (this.resolved) return;
    this.resolved = true;
    this.stopClock();
    this.button.enabled = false;
    this.env.ctx.audio.stop('glass.blow');
    this.env.piece.wobble = 0;
    const score = blowScore(this.r, this.target, this.pops);
    const err = Math.abs(this.r - this.target) / this.target;
    this.drawRing(err < 0.08 ? 'hit' : 'idle');
    if (score >= 0.8) {
      this.env.ctx.audio.play('ui.success', { volume: 0.55 });
      this.sparkleRing();
    }
    this.tw.add(0.5, (p) => (this.ring.alpha = 1 - p), { delay: 0.45 });
    this.tw.wait(0.95, () => this.onDone({ score, r: this.r, pops: this.pops }));
  }

  private burst(): void {
    const { piece, fx, ctx, toast, t } = this.env;
    this.go('burst');
    this.pops += 1;
    ctx.audio.stop('glass.blow');
    ctx.audio.play('glass.pop');
    piece.wobble = 0;
    const c = piece.bubbleCentre();
    const r = this.r;
    piece.bubbleVisible = false;
    this.button.enabled = false;
    toast.show(t('glass.blow.pop'), 2.6);

    // 12 shards of thin glass flying off for 0.6 s
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
      const shard = new Graphics()
        .poly([0, -14 - Math.random() * 10, 9, 6, -8, 8])
        .fill({ color: i % 3 === 0 ? 0xfff2c8 : 0xffa64a, alpha: 0.95 })
        .stroke({ color: 0xffffff, width: 2, alpha: 0.6 });
      shard.position.set(c.x + Math.cos(a) * r * 0.8, c.y + Math.sin(a) * r * 0.8);
      shard.rotation = a;
      const speed = 420 + Math.random() * 380;
      fx.spawn(shard, {
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 160,
        gravity: 1400,
        spin: (Math.random() - 0.5) * 18,
        life: 0.6,
        endScale: 0.6,
      });
    }
    const flash = new Graphics().circle(0, 0, r).stroke({ color: 0xfff2c8, width: 10, alpha: 0.9 });
    flash.position.set(c.x, c.y);
    fx.spawn(flash, { life: 0.3, endScale: 1.5 });

    this.drawRing('idle');
    this.tw.wait(RESET_AFTER, () => this.freshGather());
  }

  private freshGather(): void {
    const piece = this.env.piece;
    this.r = R0;
    piece.setRadius(0.01);
    piece.bubbleVisible = true;
    this.tw.add(0.35, (p) => piece.setRadius(Math.max(0.01, R0 * p)), { ease: ease.outBack });
    if (this.go('gatherBack') === 'ready') {
      this.button.enabled = true;
      return;
    }
    // closing: the last allowed burst, or the time ran out during it. The gather stays as it is
    // (tick ignores `closing`) and the move is scored from R0 with the burst penalty.
    this.tw.wait(CLOSE_AFTER, () => {
      if (this.go('closed') === 'done') this.resolve();
    });
  }

  private updateRingLook(): void {
    const err = (this.r - this.target) / this.target;
    this.drawRing(err > 0.12 ? 'danger' : Math.abs(err) < 0.07 ? 'hit' : 'idle');
    if (err > 0.12) this.ring.alpha = 0.6 + 0.4 * Math.abs(Math.sin(this.age * 18));
    else this.ring.alpha = 1;
  }

  private drawRing(look: 'idle' | 'hit' | 'danger'): void {
    if (look === this.ringLook) return;
    this.ringLook = look;
    if (look === 'hit') dashedRing(this.ring, this.target, Theme.color.star, 9);
    else if (look === 'danger') dashedRing(this.ring, this.target, Theme.color.bad, 8);
    else dashedRing(this.ring, this.target, Theme.color.paper, 6, 0.9);
  }

  /** Hot air wisps rising off the bubble while it is blown. */
  private heatShimmer(): void {
    const c = this.env.piece.bubbleCentre();
    const dot = new Sprite(softDotTexture());
    dot.anchor.set(0.5);
    dot.blendMode = 'add';
    dot.tint = 0xffb04a;
    dot.alpha = 0.6;
    dot.scale.set((14 + Math.random() * 12) / 128);
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
    dot.position.set(c.x + Math.cos(a) * this.r * 0.9, c.y + Math.sin(a) * this.r * 0.9);
    this.env.fx.spawn(dot, { vx: (Math.random() - 0.5) * 30, vy: -60 - Math.random() * 60, life: 0.8, endScale: 2.2, sway: 20 });
  }

  private sparkleRing(): void {
    const c = this.ring.position;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const star = new Graphics().star(0, 0, 4, 12, 4).fill(Theme.color.star);
      star.position.set(c.x + Math.cos(a) * this.target, c.y + Math.sin(a) * this.target);
      this.env.fx.spawn(star, {
        vx: Math.cos(a) * 160,
        vy: Math.sin(a) * 160,
        drag: 0.2,
        spin: 4,
        life: 0.7,
        endScale: 0.2,
        delay: i * 0.012,
      });
    }
  }
}
