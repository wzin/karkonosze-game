import { Container, Graphics, Text } from 'pixi.js';
import type { Audio } from '../core/Audio';
import { DESIGN } from '../core/Layout';
import { Button } from './Button';
import { Theme } from './Theme';

export interface TopBarOpts {
  title: string;
  subtitle?: string;
  backLabel: string;
  onBack: () => void;
  audio: Audio;
  muteLabel: string;
  kiosk: boolean;
}

const BUTTON_H = 72;
const MARGIN = 24;

/**
 * Bar across the top of a game scene (design width × TopBar.HEIGHT, origin top-left): back button on
 * the left, title and subtitle in the middle, sound on/off on the right. Both buttons play `ui.tap`.
 */
export class TopBar extends Container {
  static readonly HEIGHT = 110;
  private readonly titleText: Text;
  private readonly subtitleText: Text;
  private readonly speaker = new Graphics();
  private readonly titleRoom: number;

  constructor(opts: TopBarOpts) {
    super();
    const { audio, kiosk } = opts;
    const tap = () => audio.play('ui.tap');

    const bg = new Graphics()
      .rect(0, 0, DESIGN.w, TopBar.HEIGHT)
      .fill({ color: Theme.color.night, alpha: 0.8 })
      .rect(0, TopBar.HEIGHT - 2, DESIGN.w, 2)
      .fill({ color: Theme.color.ember, alpha: 0.5 });

    const back = new Button(opts.backLabel, {
      variant: 'quiet',
      height: BUTTON_H,
      icon: chevron(),
      kiosk,
      onTap: tap,
      onPress: opts.onBack,
      name: 'topbar.back',
    });
    back.position.set(MARGIN, (TopBar.HEIGHT - BUTTON_H) / 2);

    this.drawSpeaker(audio.muted); // before the Button measures its icon
    const mute = new Button(opts.muteLabel, {
      variant: 'quiet',
      height: BUTTON_H,
      icon: this.speaker,
      kiosk,
      onTap: tap,
      onPress: () => {
        audio.setMuted(!audio.muted);
        this.drawSpeaker(audio.muted);
      },
      name: 'topbar.mute',
    });
    mute.position.set(DESIGN.w - MARGIN - mute.box.w, (TopBar.HEIGHT - BUTTON_H) / 2);

    this.titleText = new Text({
      text: opts.title,
      style: { fontFamily: Theme.font.display, fontWeight: '700', fontSize: 44, fill: Theme.color.paper },
    });
    this.titleText.anchor.set(0.5, 0);
    this.subtitleText = new Text({
      text: '',
      style: { fontFamily: Theme.font.body, fontWeight: '700', fontSize: 24, fill: Theme.color.emberSoft },
    });
    this.subtitleText.anchor.set(0.5, 0);
    // the title keeps clear of whichever button is wider, so it stays centred on the screen
    this.titleRoom = DESIGN.w - 2 * (MARGIN * 2 + Math.max(back.box.w, mute.box.w));
    if (this.titleText.width > this.titleRoom) this.titleText.scale.set(this.titleRoom / this.titleText.width);

    this.addChild(bg, back, this.titleText, this.subtitleText, mute);
    this.setSubtitle(opts.subtitle ?? '');
  }

  setSubtitle(s: string): void {
    this.subtitleText.text = s;
    this.subtitleText.visible = s.length > 0;
    this.subtitleText.scale.set(1);
    if (this.subtitleText.width > this.titleRoom) this.subtitleText.scale.set(this.titleRoom / this.subtitleText.width);
    const both = this.subtitleText.visible;
    this.titleText.position.set(DESIGN.w / 2, both ? 12 : (TopBar.HEIGHT - this.titleText.height) / 2);
    this.subtitleText.position.set(DESIGN.w / 2, 68);
  }

  /** Speaker with sound waves, or crossed out when muted; drawn around (0, 0). */
  private drawSpeaker(muted: boolean): void {
    const s = 30;
    const g = this.speaker.clear();
    const body = [-0.5, -0.2, -0.22, -0.2, 0.08, -0.48, 0.08, 0.48, -0.22, 0.2, -0.5, 0.2];
    g.poly(body.map((v) => v * s)).fill(Theme.color.paper);
    if (muted) {
      g.moveTo(s * 0.26, -s * 0.2)
        .lineTo(s * 0.62, s * 0.2)
        .moveTo(s * 0.62, -s * 0.2)
        .lineTo(s * 0.26, s * 0.2)
        .stroke({ color: Theme.color.bad, width: 5, cap: 'round' });
    } else {
      for (const r of [s * 0.3, s * 0.55]) {
        g.moveTo(s * 0.08 + r * Math.cos(-0.75), r * Math.sin(-0.75))
          .arc(s * 0.08, 0, r, -0.75, 0.75)
          .stroke({ color: Theme.color.paper, width: 4, cap: 'round' });
      }
    }
  }
}

function chevron(): Graphics {
  return new Graphics()
    .moveTo(7, -13)
    .lineTo(-6, 0)
    .lineTo(7, 13)
    .stroke({ color: Theme.color.paper, width: 5, cap: 'round', join: 'round' });
}
