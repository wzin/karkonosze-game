# Synthetic checks for the birefnet repair step (no network).
import numpy as np
from cutout import label, convex_hull_mask, repair, defringe, key_sky, peel_rim

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
