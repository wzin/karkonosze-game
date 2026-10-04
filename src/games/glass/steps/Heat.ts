import { Container, Graphics, Text } from 'pixi.js';
import { Button } from '../../../ui/Button';
import { Theme } from '../../../ui/Theme';
import { ease } from '../fx';
import { HEAT, LIMITS, heatScore, needlePos } from '../rules';
import { LAYOUT } from '../ui';
import { Step, type StepEnv } from './Step';

const W = 900;
const H = 70;
const LO = 0.5 - HEAT.zoneHalf;
const HI = 0.5 + HEAT.zoneHalf;
const GAUGE_Y = 760;
const ASH = 0x6b6b6b;
const EMBER = 0xf08a2c;
const FIRE = 0xffd34d;
/** needlePos(t) starts mid-gauge; start the swing at the cold end, where fresh glass is. */
const T0 = (Math.PI * 1.5) / 2.6;

/**
 * Rozgrzej: a needle swings over ash / ember / fire; tap when it is in the ember zone. The gather
 * glows along with the needle. Score = heatScore(needle) at the tap or when the 12 s run out.
 */
export class HeatStep extends Step {
  readonly kind = 'heat';
  private readonly gauge = new Container();
  private readonly needle = new Graphics();
  private readonly zoneGlow = new Graphics();
  private readonly labels: Text[] = [];
  private button!: Button;
  private t = T0;
  private pos = needlePos(T0);
  private frozen = false;
  private age = 0;

  constructor(
    env: StepEnv,
    private readonly onDone: (score: number) => void,
  ) {
    super(env, LIMITS.heat);
  }

  protected start(): void {
    const { t, piece, card } = this.env;
    card.set(t('glass.heat.h'), t('glass.heat.p'));
    piece.position.set(LAYOUT.furnaceTip.x, LAYOUT.furnaceTip.y);
    piece.setGlow(this.pos);

    this.buildGauge();
    this.button = new Button(t('glass.heat.btn'), {
      kiosk: this.env.ctx.kiosk,
      name: 'glass.heat.btn',
      width: 460,
      // the pick is timed: it lands on pointerdown, not on release
      onTap: () => this.pick(false),
    });
    this.button.position.set(960 - this.button.box.w / 2, 908);
    this.addChild(this.gauge, this.button);
    this.gauge.alpha = 0;
  }

  override debug(): Record<string, number | string> {
    return { needle: this.pos, frozen: this.frozen ? 1 : 0 };
  }

  protected override timeUp(): void {
    this.env.toast.show(this.env.t('glass.timeUp'));
    this.pick(true);
  }

  protected override tick(dt: number): void {
    this.age += dt;
    this.gauge.alpha = Math.min(1, this.age / 0.3);
    if (!this.frozen) {
      this.t += dt;
      this.pos = needlePos(this.t);
      this.env.piece.setGlow(this.pos);
    }
    this.needle.x = this.pos * W;
    const inZone = this.pos >= LO && this.pos <= HI;
    const glow = this.frozen ? (inZone ? 1 : 0) : inZone ? 0.75 + 0.25 * Math.sin(this.age * 14) : 0;
    this.zoneGlow.alpha += (glow - this.zoneGlow.alpha) * Math.min(1, dt * 14);
    const zone = this.pos < LO ? 0 : this.pos > HI ? 2 : 1;
    this.labels.forEach((l, i) => {
      const s = i === zone ? 1.18 : 1;
      l.scale.set(l.scale.x + (s - l.scale.x) * Math.min(1, dt * 12));
    });
  }

  private pick(timedOut: boolean): void {
    if (this.frozen) return;
    this.frozen = true;
    this.stopClock();
    this.button.enabled = false;
    const score = heatScore(this.pos);
    const good = score > HEAT.missScore;
    const audio = this.env.ctx.audio;
    audio.play('ui.tap');
    if (!timedOut) audio.play(good ? 'ui.success' : 'ui.fail', { volume: 0.55 });
    this.stamp(good);

    const piece = this.env.piece;
    const from = { ...LAYOUT.furnaceTip };
    const to = LAYOUT.stageTip;
    this.tw.add(
      0.85,
      (p) => {
        piece.x = from.x + (to.x - from.x) * p;
        // a little lift as the pipe comes out of the mouth
        piece.y = from.y + (to.y - from.y) * p - Math.sin(p * Math.PI) * 40;
      },
      { delay: 0.6, ease: ease.inOutSine },
    );
    this.tw.add(0.4, (p) => (this.gauge.alpha = 1 - p), { delay: 0.9 });
    this.tw.wait(1.5, () => this.onDone(score));
  }

  /** A word over the needle: which zone the glass came out of. */
  private stamp(good: boolean): void {
    const zone = this.pos < LO ? 'ash' : this.pos > HI ? 'fire' : 'heat';
    const word = new Text({
      text: `${this.env.t(`glass.zones.${zone}`)}${good ? '!' : ''}`,
      style: {
        fontFamily: Theme.font.display,
        fontWeight: '900',
        fontSize: 54,
        fill: good ? Theme.color.star : Theme.color.paper,
        stroke: { color: Theme.color.night, width: 8, join: 'round' },
      },
    });
    word.anchor.set(0.5, 1);
    word.position.set(this.pos * W, -26);
    this.gauge.addChild(word);
    this.tw.add(0.45, (p) => word.scale.set(p), { ease: ease.outBack });
  }

  private buildGauge(): void {
    const { t } = this.env;
    const frame = new Graphics()
      .roundRect(-8, -8 + 6, W + 16, H + 16, (H + 16) / 2)
      .fill({ color: Theme.color.night, alpha: 0.45 })
      .roundRect(-8, -8, W + 16, H + 16, (H + 16) / 2)
      .fill({ color: Theme.color.night, alpha: 0.9 })
      .stroke({ color: Theme.color.ember, alpha: 0.55, width: 2 });
    const zones = new Graphics()
      .roundRect(0, 0, W * LO + H / 2, H, H / 2)
      .fill(ASH)
      .roundRect(W * HI - H / 2, 0, W * (1 - HI) + H / 2, H, H / 2)
      .fill(FIRE)
      .rect(W * LO, 0, W * (HI - LO), H)
      .fill(EMBER)
      // the sweet middle of the ember zone is a touch brighter
      .rect(W * (0.5 - HEAT.zoneHalf / 2), 0, W * HEAT.zoneHalf, H)
      .fill({ color: 0xffb24a, alpha: 0.55 })
      .rect(0, 6, W, 6)
      .fill({ color: 0xffffff, alpha: 0.12 });
    this.zoneGlow
      .roundRect(W * LO - 10, -12, W * (HI - LO) + 20, H + 24, 18)
      .stroke({ color: Theme.color.star, width: 6, alpha: 0.9 });
    this.zoneGlow.alpha = 0;

    this.needle
      .poly([-16, -30, 16, -30, 0, -12])
      .fill(Theme.color.paper)
      .stroke({ color: Theme.color.ink, width: 3, join: 'round' })
      .roundRect(-7, -16, 14, H + 32, 7)
      .fill(Theme.color.paper)
      .stroke({ color: Theme.color.ink, width: 3 });

    const centres = [LO / 2, 0.5, (1 + HI) / 2];
    (['ash', 'heat', 'fire'] as const).forEach((key, i) => {
      const label = new Text({
        text: t(`glass.zones.${key}`),
        style: {
          fontFamily: Theme.font.body,
          fontWeight: '800',
          fontSize: 30,
          fill: i === 1 ? Theme.color.star : Theme.color.paper,
          stroke: { color: Theme.color.night, width: 6, join: 'round' },
        },
      });
      label.anchor.set(0.5, 0);
      label.position.set(centres[i] * W, H + 18);
      this.labels.push(label);
    });

    this.gauge.addChild(frame, zones, this.zoneGlow, ...this.labels, this.needle);
    this.gauge.position.set(960 - W / 2, GAUGE_Y);
  }
}
