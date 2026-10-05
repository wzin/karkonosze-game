# Synthetic checks for the birefnet repair step (no network).
import numpy as np
from cutout import label, convex_hull_mask, repair, defringe, key_sky, peel_rim, key_luma, paper_sides

BG = (200, 200, 200)


def canvas(h=120, w=120):
    rgb = np.zeros((h, w, 3), np.uint8); rgb[:] = BG
    return rgb, np.zeros((h, w), np.uint8)


def test_label_counts_separate_components_and_merges_u_shapes():
    m = np.zeros((10, 10), bool)
    m[1:4, 1:4] = True; m[6:9, 6:9] = True
    _, n = label(m); assert n == 2
    u = np.zeros((6, 7), bool); u[1:5, 1] = True; u[1:5, 5] = True; u[4, 1:6] = True
    _, n = label(u); assert n == 1


def test_convex_hull_fills_concavity():
    m = np.zeros((20, 20), bool); m[2:18, 2:5] = True; m[2:18, 15:18] = True; m[15:18, 2:18] = True
    h = convex_hull_mask(m)
    assert h[8, 10] and not m[8, 10]


def test_dark_interior_eaten_by_birefnet_is_refilled():
    rgb, a = canvas()
    rgb[20:100, 20:100] = (30, 25, 20); a[20:100, 20:100] = 255
    a[40:80, 40:80] = 40                      # birefnet made the dark middle see-through
    out, s = repair(rgb, a)
    assert s["hull_low_ratio"] > 0.2 and out[60, 60] == 255 and out[5, 5] == 0


def test_background_looking_hole_stays_transparent():
    rgb, a = canvas()
    rgb[20:100, 20:100] = (120, 80, 40); a[20:100, 20:100] = 255
    rgb[45:75, 45:75] = BG; a[45:75, 45:75] = 0   # e.g. the gap inside a basket handle
    out, s = repair(rgb, a)
    assert out[60, 60] == 0 and s["kept_bg_hole_px"] == 900


def test_pale_gap_in_vignetted_background_is_not_filled():
    rgb, a = canvas()
    rgb[20:100, 20:100] = (60, 120, 40); a[20:100, 20:100] = 255
    rgb[45:75, 45:75] = (235, 228, 210); a[45:75, 45:75] = 0   # cream gap, bg is grey 200
    out, _ = repair(rgb, a)
    assert out[60, 60] == 0


def test_confidently_removed_coloured_hole_stays_transparent():
    rgb, a = canvas()
    rgb[20:100, 20:100] = (90, 90, 90); a[20:100, 20:100] = 255
    rgb[45:75, 45:75] = (230, 140, 40); a[45:75, 45:75] = 0    # orange puddle inside a cable loop
    out, _ = repair(rgb, a)
    assert out[60, 60] == 0


def test_key_sky_removes_flat_sky_and_keeps_land_band():
    h, w = 90, 160
    rgb = np.zeros((h, w, 3), np.uint8); rgb[:] = (205, 205, 208)
    for x in range(w):                                  # wavy ridge, land below
        top = 40 + int(10 * np.sin(x / 15))
        rgb[top:, x] = (50, 70, 90)
    alpha, s = key_sky(rgb)
    assert alpha[2, 80] == 0 and alpha[h - 1, 5] == 255 and alpha[h - 1, w - 5] == 255
    assert 0.3 < s["sky_ratio"] < 0.55


SKY, LAND, RIM, PALE = (205, 205, 208), (60, 80, 100), (232, 232, 236), (225, 226, 230)


def _band(obj=None):
    """Flat sky over dark land (from y=120) with a 6 px light paper rim on top of the land;
    optionally a light, neutral object (y0, y1, x0, x1) standing on the rim and touching the sky."""
    rgb = np.zeros((200, 360, 3), np.uint8); rgb[:] = SKY
    rgb[120:] = LAND
    rgb[114:120] = RIM
    if obj:
        y0, y1, x0, x1 = obj
        rgb[y0:y1, x0:x1] = PALE
    return rgb


def _peel(rgb):
    alpha, s = key_sky(rgb)
    return peel_rim(rgb, alpha, s["bg"])


BIG = (24, 114, 100, 260)            # 160 x 90 light object, e.g. the observatory discs on a summit


def test_peel_rim_keeps_big_light_object_inside_the_rim_depth_and_removes_the_rim_beside_it():
    a, removed = _peel(_band(BIG))
    assert removed > 0
    assert a[117, 30] == 0 and a[117, 330] == 0         # rim strip left and right of the object: gone
    # probes inside the rim depth (< RIM_DEPTH px from the sky), i.e. real rim candidates
    assert a[30, 180] == 255                             # 6 px below the object's top edge
    assert a[70, 106] == 255 and a[70, 253] == 255       # 6 px inside its left / right edge
    assert a[160, 30] == 255                             # land kept


def test_big_light_object_survives_only_because_of_the_keep_rule(monkeypatch):
    import cutout
    monkeypatch.setattr(cutout, "RIM_KEEP_AREA", 10 ** 9)   # protection off
    a, _ = _peel(_band(BIG))
    assert a[30, 180] == 0 and a[70, 106] == 0              # the same probes are peeled


def test_small_light_skyline_detail_is_removed():
    # documented limit: pale, neutral details narrower than ~120 px (here a 50 x 8 spire) count as rim
    a, _ = _peel(_band((106, 114, 150, 200)))
    assert (a[106:114, 150:200] == 0).all()


def test_key_sky_also_removes_enclosed_sky_pockets():
    rgb = np.zeros((120, 200, 3), np.uint8); rgb[:] = (205, 205, 208)
    rgb[50:, :] = (60, 90, 60)
    rgb[30:50, 60:140] = (60, 90, 60)                   # a bridge of land that encloses a pocket
    rgb[50:75, 80:120] = (205, 205, 208)                # 40x25 sky pocket under it
    alpha, s = key_sky(rgb)
    assert alpha[62, 100] == 0 and s["sky_pocket_px"] > 0


def test_defringe_removes_grey_from_half_transparent_edge():
    rgb = np.full((1, 1, 3), 115, np.uint8)        # 50 % of (30,30,30) over grey 200
    out = defringe(rgb, np.array([[128]], np.uint8), np.array(BG, np.float32))
    assert abs(int(out[0, 0, 0]) - 30) <= 3


def test_luma_key_gives_mist_on_black_a_soft_alpha_and_its_own_colour():
    h, w = 60, 200
    rgb = np.zeros((h, w, 3), np.uint8); rgb[:] = (8, 8, 10)
    x = np.arange(w)
    dens = np.clip(1 - np.abs(x - 100) / 70, 0, 1)        # dense in the middle, fading out
    for y in range(20, 40):
        rgb[y] = (np.array([8, 8, 10]) + dens[:, None] * (np.array([220, 222, 235]) - [8, 8, 10])).astype(np.uint8)
    col, a, s = key_luma(rgb)
    assert s["method"] == "luma"
    assert a[5, 100] == 0 and a[50, 10] == 0               # background gone
    assert a[30, 100] == 255 and 0 < a[30, 60] < 255        # dense core opaque, flanks half-transparent
    assert a[30, 160] < a[30, 130] < a[30, 100]
    assert abs(int(col[30, 60, 2]) - 235) <= 12             # un-mixed back to the mist colour, not grey


def test_key_sky_follows_haze_that_lightens_towards_the_skyline():
    # flat sky 205 at the top lightening to 225 just above the land: past the tolerance (~10)
    h, w = 200, 160
    rgb = np.zeros((h, w, 3), np.uint8)
    for y in range(h):
        rgb[y] = int(205 + 20 * y / 140)
    rgb[140:] = (60, 80, 60)
    alpha, s = key_sky(rgb)
    assert alpha[135, 80] == 0 and alpha[150, 80] == 255     # haze keyed down to the land
    assert s["sky_drift"] > 15


def test_pale_mist_below_the_skyline_is_not_keyed_as_drifting_sky():
    rgb = np.zeros((200, 160, 3), np.uint8); rgb[:] = (205, 205, 208)
    rgb[80:] = (60, 80, 60)
    rgb[120:160, 30:130] = (207, 207, 210)                   # sky-coloured mist bank inside the land
    alpha, _ = key_sky(rgb, pockets=False)
    assert alpha[140, 80] == 255
    alpha, _ = key_sky(rgb)                                   # with pockets on it would be punched out
    assert alpha[140, 80] == 0


def test_paper_sides_finds_the_margin_of_a_band_painted_on_a_sheet():
    rgb = np.zeros((300, 400, 3), np.uint8); rgb[:] = (240, 238, 232)    # white sheet
    rgb[:, 20:380] = (205, 205, 208)                                     # grey sky inside the painting
    rgb[150:270, 20:380] = (60, 80, 60)                                  # land, 30 px of sheet below
    rgb[270:] = (240, 238, 232)
    x0, x1, y1 = paper_sides(rgb)
    assert 20 <= x0 <= 30 and 370 <= x1 <= 380 and 260 <= y1 <= 270
    land = rgb.copy(); land[150:] = (60, 80, 60)                         # land reaching the bottom
    land[:, :20] = land[:, 380:] = (60, 80, 60)
    assert paper_sides(land) is None


def test_light_peel_keeps_a_thin_dark_mast_that_the_full_peel_erodes():
    rgb = np.zeros((200, 200, 3), np.uint8); rgb[:] = (205, 205, 208)
    rgb[120:] = (70, 75, 100)
    rgb[40:120, 98:104] = (70, 75, 100)                        # 6 px wide dark transmitter mast
    alpha, s = key_sky(rgb)
    full, _ = peel_rim(rgb, alpha, s["bg"])
    light, _ = peel_rim(rgb, alpha, s["bg"], light=True)
    assert full[60, 100] == 0 and light[60, 100] == 255
    assert light[20, 100] == 0 and light[160, 100] == 255
