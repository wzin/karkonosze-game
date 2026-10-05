import {
  Container,
  Graphics,
  Point,
  Sprite,
  Text,
  Texture,
  type DestroyOptions,
  type FederatedPointerEvent,
} from 'pixi.js';
import type { ViewLayout } from '../core/Layout';
import { LiveHitBox, Theme, type HitBox } from './Theme';

export interface ButtonOpts {
  width?: number;
  height?: number;
  variant?: 'primary' | 'quiet' | 'ghost';
  /** A texture (fitted to the button) or a view drawn around its own (0, 0), e.g. a Graphics icon. */
  icon?: Texture | Container;
  kiosk?: boolean;
  /** The live fit scale (`ctx.layout`): the hit area then never maps to under 44 CSS px on screen. */
  layout?: ViewLayout;
  onPress?: () => void;
  /** Runs on every pointerdown, before the release; scenes play the `ui.tap` moment here. */
  onTap?: () => void;
  /** Dotted id ("glass.heat.btn"); dev builds expose the button as `window.__bk.buttons[name]`. */
  name?: string;
}

type Variant = NonNullable<ButtonOpts['variant']>;

const PRESSED_SCALE = 0.96;
/** The darker edge under a primary button. */
const LIP = 6;

const VARIANTS = {
  primary: { fill: Theme.color.ember, fillAlpha: 1, lip: 0xa35f1d, line: Theme.color.emberSoft, lineAlpha: 0.45, text: Theme.color.ink },
  quiet: { fill: Theme.color.night, fillAlpha: 0.62, lip: null, line: Theme.color.paper, lineAlpha: 0.55, text: Theme.color.paper },
  ghost: { fill: Theme.color.night, fillAlpha: 0, lip: null, line: Theme.color.paper, lineAlpha: 0.3, text: Theme.color.paper },
} as const;

/**
 * Rounded pill with a label and an optional icon, laid out from its top-left corner. pointerdown
 * presses it (scale 0.96, `onTap`), release over it fires `onPress`, release elsewhere only resets.
 * The hit area grows around small buttons to `effectiveHitMin(kiosk, layout.scale)`: 96 / 64 design
 * px, or more on a small screen, so it is never under 44 CSS px; it follows a resize by itself.
 */
export class Button extends Container {
  onPress?: () => void;
  /** Centred on the button and scaled while pressed. */
  protected readonly face = new Container();
  private readonly bg = new Graphics();
  private readonly text: Text;
  private readonly icon: Container | null;
  private readonly variant: Variant;
  private readonly unregister: () => void;
  private readonly hit: LiveHitBox;
  private w = 0;
  private readonly h: number;
  private isEnabled = true;
  private pressedBy: number | null = null;

  constructor(
    label: string,
    private readonly opts: ButtonOpts = {},
  ) {
    super();
    this.onPress = opts.onPress;
    this.variant = opts.variant ?? 'primary';
    this.h = opts.height ?? Theme.size.button.h;
    this.text = new Text({
      text: label,
      style: {
        fontFamily: Theme.font.body,
        fontWeight: '800',
        fontSize: Math.round(this.h * 0.36),
        fill: VARIANTS[this.variant].text,
      },
    });
    this.text.anchor.set(0.5);
    this.icon = opts.icon ? (opts.icon instanceof Texture ? fitIcon(opts.icon, this.h * 0.46) : opts.icon) : null;
    this.face.addChild(this.bg);
    if (this.icon) this.face.addChild(this.icon);
    this.face.addChild(this.text);
    this.addChild(this.face);

    if (opts.name) this.label = opts.name;
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.interactiveChildren = false;
    this.on('pointerdown', (e) => this.pressStart(e));
    this.on('pointerup', (e) => this.pressEnd(e, true));
    this.on('pointerupoutside', (e) => this.pressEnd(e, false));
    this.on('pointercancel', (e) => this.pressEnd(e, false));
    this.hit = new LiveHitBox(() => ({ w: this.w, h: this.h }), opts.kiosk ?? false, opts.layout);
    this.hitArea = this.hit;

    this.layout();
    this.unregister = opts.name ? registerDevButton(opts.name, () => this.screenTarget()) : () => {};
  }

  setLabel(s: string): void {
    this.text.text = s;
    this.layout();
  }

  get enabled(): boolean {
    return this.isEnabled;
  }

  set enabled(v: boolean) {
    if (v === this.isEnabled) return;
    this.isEnabled = v;
    this.alpha = v ? 1 : 0.45;
    this.eventMode = v ? 'static' : 'none';
    this.cursor = v ? 'pointer' : 'default';
    if (!v) this.release();
  }

  /** Layout size (without the hit-area margin or the primary lip). */
  get box(): { w: number; h: number } {
    return { w: this.w, h: this.h };
  }

  /** The hit area as it stands now (it grows when the screen shrinks), in the button's own space. */
  get hitRect(): HitBox {
    return this.hit.box;
  }

  override destroy(options?: DestroyOptions): void {
    this.unregister();
    super.destroy(options);
  }

  /** @returns false when the press was refused (disabled). */
  protected pressStart(e: FederatedPointerEvent): boolean {
    if (!this.isEnabled) return false;
    // a newer pointer takes over: a press whose pointerup never came must not lock the button
    this.pressedBy = e.pointerId;
    this.face.scale.set(PRESSED_SCALE);
    this.opts.onTap?.();
    return true;
  }

  protected pressEnd(e: FederatedPointerEvent, inside: boolean): void {
    if (this.pressedBy !== e.pointerId) return;
    this.release();
    if (inside && this.isEnabled) this.onPress?.();
  }

  /** Drops the current press without firing onPress. */
  protected release(): void {
    this.pressedBy = null;
    this.face.scale.set(1);
  }

  private layout(): void {
    const h = this.h;
    const pad = Math.round(h * 0.4);
    const gap = Math.round(h * 0.14);
    const hasLabel = this.text.text.length > 0;
    const iconW = this.icon ? this.icon.width : 0;
    const spacing = this.icon && hasLabel ? gap : 0;

    this.text.visible = hasLabel;
    this.text.scale.set(1);
    const natural = iconW + spacing + (hasLabel ? this.text.width : 0);
    const auto = hasLabel ? Math.max(Theme.size.button.minW, natural + pad * 2) : Math.max(h, iconW + pad);
    this.w = Math.ceil(this.opts.width ?? auto);

    // a fixed width too narrow for the label shrinks the label
    const room = this.w - pad * 2 - iconW - spacing;
    if (hasLabel && this.text.width > room) this.text.scale.set(Math.max(room, 1) / this.text.width);

    let x = -(iconW + spacing + (hasLabel ? this.text.width : 0)) / 2;
    if (this.icon) {
      this.icon.position.set(x + iconW / 2, 0);
      x += iconW + spacing;
    }
    // optical centre: Nunito's line box sits a little high
    this.text.position.set(x + this.text.width / 2, Math.round(h * 0.02));

    this.face.position.set(this.w / 2, h / 2);
    this.drawBackground();
  }

  /** Centre and hit-box size on screen (CSS px), for the dev registry. */
  private screenTarget(): DevTarget {
    const b = this.hit.box;
    const c = this.toGlobal(new Point(this.w / 2, this.h / 2));
    const a = this.toGlobal(new Point(b.x, b.y));
    const z = this.toGlobal(new Point(b.x + b.width, b.y + b.height));
    return { x: c.x, y: c.y, width: Math.abs(z.x - a.x), height: Math.abs(z.y - a.y) };
  }

  private drawBackground(): void {
    const v = VARIANTS[this.variant];
    const { w, h } = this;
    const r = Math.min(Theme.size.button.radius, h / 2);
    this.bg.clear();
    if (v.lip !== null) this.bg.roundRect(-w / 2, -h / 2 + LIP, w, h, r).fill({ color: v.lip });
    this.bg
      .roundRect(-w / 2, -h / 2, w, h, r)
      .fill({ color: v.fill, alpha: v.fillAlpha })
      .stroke({ color: v.line, alpha: v.lineAlpha, width: 2 });
  }
}

function fitIcon(tex: Texture, size: number): Sprite {
  const sprite = new Sprite(tex);
  sprite.anchor.set(0.5);
  sprite.scale.set(size / Math.max(tex.width, tex.height, 1));
  return sprite;
}

interface DevTarget {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Dev only: lets the smoke tests find a button's centre and hit-box size on screen (CSS px).
 * Returns the unregister.
 */
function registerDevButton(name: string, target: () => DevTarget): () => void {
  if (!import.meta.env.DEV) return () => {};
  const bk = (window.__bk ??= { sceneId: null });
  const buttons = (bk.buttons ??= {});
  const locate = () => {
    const t = target();
    return { x: t.x, y: t.y, width: t.width, height: t.height };
  };
  buttons[name] = locate;
  return () => {
    if (buttons[name] === locate) delete buttons[name];
  };
}
