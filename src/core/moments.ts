/**
 * Game moments → candidate clips (ids from public/assets/audio/manifest.json). Audio plays the first
 * candidate the manifest has, so a specific clip may fall back to a generic ui/ one. The hub and the
 * games refer to sounds ONLY through these moment names.
 *
 * Loudness: the sparse loops herbs/steps, mine/drip and mine/geiger_slow came out 3–7 LU under their
 * target because the true-peak cap stopped normalisation. Howler cannot play above volume 1.0, so
 * scenes should not try to make up for it; give the other layers lower volumes instead.
 */
export const MOMENTS: Record<string, string[]> = {
  'ui.tap': ['ui/tap'],
  'ui.success': ['ui/success'],
  'ui.fail': ['ui/fail'],
  'ui.star': ['ui/star'],

  'hub.music': ['music/hub'],
  'hub.wind': ['turnips/wind'],

  'glass.music': ['music/glass'],
  'glass.furnace': ['glass/furnace'],
  'glass.blow': ['glass/blow'],
  'glass.pop': ['glass/pop', 'ui/fail'],
  'glass.pigment': ['glass/pigment'],
  'glass.mold': ['glass/mold', 'ui/tap'],
  'glass.fanfare': ['glass/fanfare', 'ui/success'],

  'turnips.music': ['music/turnips'],
  'turnips.pop': ['turnips/pop', 'ui/tap'],
  'turnips.steps': ['turnips/steps'],
  'turnips.thunder': ['turnips/thunder'],
  'turnips.wind': ['turnips/wind'],
  'turnips.correct': ['ui/success'],
  'turnips.wrong': ['ui/fail'],
  'turnips.grumble': ['turnips/grumble'],

  'mine.music': ['music/mine'],
  'mine.drip': ['mine/drip'],
  'mine.geigerSlow': ['mine/geiger_slow'],
  'mine.geigerFast': ['mine/geiger_fast'],
  'mine.pick': ['mine/pick', 'ui/tap'],
  'mine.bat': ['mine/bat'],
  'mine.rumble': ['mine/rumble'],
  'mine.bell': ['mine/bell', 'ui/success'],

  'herbs.music': ['music/herbs'],
  'herbs.steps': ['herbs/steps'],
  'herbs.pluck': ['herbs/pluck', 'ui/tap'],
  'herbs.sneeze': ['herbs/sneeze', 'ui/fail'],
  'herbs.grind': ['herbs/grind'],
  'herbs.pour': ['herbs/pour'],
  'herbs.birds': ['herbs/birds'],
};
