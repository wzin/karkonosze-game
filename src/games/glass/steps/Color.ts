import { Container, Sprite, Text } from 'pixi.js';
import { sprite } from '../../../core/Assets';
import { pick } from '../../../core/Rng';
import { Theme } from '../../../ui/Theme';
import { bezier, ease, mixColor, softDotTexture } from '../fx';
import { LIMITS, MINERALS, type MineralId } from '../rules';
import { LAYOUT, Tile, standing } from '../ui';
import { Step, type StepEnv } from './Step';

const JAR_H = 180;
const GRAINS = 40;
const FLIGHT = 0.5;
/** Height of the blank paper label on each jar (share of the jar's height from its bottom). */
const LABEL_AT: Record<MineralId, number> = { kobalt: 0.47, zelazo: 0.43, zloto: 0.43, mangan: 0.4, uran: 0.47 };

interface Grain {
  view: Sprite;
  from: { x: number; y: number };
  ctrl: { x: number; y: number };
  to: { x: number; y: number };
  age: number;
  delay: number;
  landed: boolean;
}

/**
 * Zabarw: five oxide jars on the shelf. A tap pours 40 grains of pigment along an arc into the
 * bubble, which takes the mineral's tint as they land. 15 s limit: no choice → a random wrong jar.
 */
export class ColorStep extends Step {
  readonly kind = 'colour';
  private readonly tiles = new Map<MineralId, Tile>();
  private readonly grains: Grain[] = [];
  private readonly grainLayer = new Container();
  private chosen: MineralId | null = null;
  private landed = 0;

  constructor(
    env: StepEnv,
    private readonly onDone: (mineral: MineralId) => void,
  ) {
    super(env, LIMITS.color);
  }

  protected start(): void {
    const { t, card, ctx } = this.env;
    card.set(t('glass.color.h'), t('glass.color.p'));
    MINERALS.forEach((m, i) => {
      const view = new Container();
      const jar = standing(sprite(ctx.assets, `glass/jar_${m.id}`, { w: 120, h: JAR_H, tint: m.tint }), JAR_H);
      if (!ctx.assets.has(`glass/jar_${m.id}`)) jar.anchor.set(0.5, 1);
      const label = new Text({
        text: t(`glass.minerals.${m.id}.label`),
        style: { fontFamily: Theme.font.display, fontWeight: '700', fontSize: 24, fill: Theme.color.ink },
      });
      label.anchor.set(0.5);
      label.position.set(0, -JAR_H * LABEL_AT[m.id]);
      const room = jar.width * 0.62;
      if (label.width > room) label.scale.set(room / label.width);
      view.addChild(jar, label);

      const tile = new Tile({
        view,
        height: JAR_H,
        width: jar.width,
        caption: t(`glass.minerals.${m.id}.name`),
        name: `glass.jar.${m.id}`,
        kiosk: ctx.kiosk,
        layout: ctx.layout,
      });
      tile.position.set(LAYOUT.rowX(i), LAYOUT.rowBottom - 40);
      tile.onPick = () => this.choose(m.id);
      tile.alpha = 0;
      this.tw.add(0.35, (p) => {
        tile.alpha = p;
        tile.y = LAYOUT.rowBottom - 40 + (1 - p) * 60;
      }, { delay: i * 0.06, ease: ease.outBack });
      this.tiles.set(m.id, tile);
      this.addChild(tile);
    });
    this.addChild(this.grainLayer);
  }

  protected override timeUp(): void {
    this.env.toast.show(this.env.t('glass.timeUp'));
    const wrong = MINERALS.filter((m) => m.id !== this.env.order.mineral);
    this.choose(pick(this.env.rng, wrong).id);
  }

  protected override tick(dt: number): void {
    for (const tile of this.tiles.values()) tile.update(dt);
    if (this.chosen === null) return;
    const tint = MINERALS.find((m) => m.id === this.chosen)?.tint ?? 0xffffff;
    for (const g of this.grains) {
      if (g.landed) continue;
      g.age += dt;
      const t = (g.age - g.delay) / FLIGHT;
      if (t < 0) continue;
      g.view.visible = true;
      const p = bezier(g.from, g.ctrl, g.to, ease.inQuad(Math.min(t, 1)));
      g.view.position.set(p.x, p.y);
      g.view.scale.set(g.view.scale.x * (1 - dt * 0.6));
      if (t >= 1) {
        g.landed = true;
        g.view.visible = false;
        this.landed += 1;
        this.env.piece.setColour(tint, this.landed / GRAINS);
      }
    }
  }

  private choose(id: MineralId): void {
    if (this.chosen !== null) return;
    this.chosen = id;
    this.stopClock();
    const { ctx, piece } = this.env;
    ctx.audio.play('glass.pigment');
    for (const [mid, tile] of this.tiles) tile.settle(mid === id);

    const tile = this.tiles.get(id);
    if (!tile) return;
    // tip the jar towards the bubble and back
    const item = tile.item;
    this.tw.add(0.7, (p) => (item.rotation = -Math.sin(p * Math.PI) * 0.45), { ease: ease.linear });

    const tint = MINERALS.find((m) => m.id === id)?.tint ?? 0xffffff;
    const from = tile.topIn();
    const c = piece.bubbleCentre();
    const r = piece.r;
    for (let i = 0; i < GRAINS; i++) {
      const dot = new Sprite(softDotTexture());
      dot.anchor.set(0.5);
      // a lighter grain reads better against the dark workshop; every fifth one sparkles
      dot.tint = mixColor(tint, 0xffffff, i % 5 === 0 ? 0.6 : 0.25);
      if (i % 5 === 0) dot.blendMode = 'add';
      dot.scale.set((14 + Math.random() * 16) / 128 * 2);
      dot.visible = false;
      this.grainLayer.addChild(dot);
      const start = { x: from.x + (Math.random() - 0.5) * 50, y: from.y + (Math.random() - 0.5) * 20 };
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r * 0.6;
      const end = { x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d };
      const ctrl = { x: (start.x + end.x) / 2 + (Math.random() - 0.5) * 120, y: Math.min(start.y, end.y) - 220 - Math.random() * 120 };
      this.grains.push({ view: dot, from: start, ctrl, to: end, age: 0, delay: 0.12 + i * 0.006 + Math.random() * 0.12, landed: false });
    }
    // the bubble swells a touch as the colour soaks in
    this.tw.add(0.5, (p) => piece.squash(1 + Math.sin(p * Math.PI) * 0.06, 1 + Math.sin(p * Math.PI) * 0.06), {
      delay: 0.45,
      ease: ease.linear,
    });
    this.tw.wait(1.45, () => {
      piece.setColour(tint, 1);
      this.onDone(id);
    });
  }
}
