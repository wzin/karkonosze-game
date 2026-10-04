# Synthetic checks for the birefnet repair step (no network).
import numpy as np
from cutout import label, convex_hull_mask, repair, defringe, key_sky

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


def test_defringe_removes_grey_from_half_transparent_edge():
    rgb = np.full((1, 1, 3), 115, np.uint8)        # 50 % of (30,30,30) over grey 200
    out = defringe(rgb, np.array([[128]], np.uint8), np.array(BG, np.float32))
    assert abs(int(out[0, 0, 0]) - 30) <= 3
