"""Cut out every `cutout: true` asset with fal-ai/birefnet.

    .venv/bin/python cutout.py [--only PREFIX] [--force ID ...]

raw/<id>.png -> raw/<id>.cut.png (RGBA, same size as the raw image).

After birefnet we guard against its known failure on dark subjects: it turns
parts of the interior semi-transparent. If more than 20 % of the pixels inside
the convex hull of the mask have alpha < 128 (the brief's trigger), or there
are enclosed holes whose raw colour is clearly not the background, enclosed
holes are refilled with alpha 255 and the raw colour. Holes that look like the
flat background (e.g. inside a basket handle) stay transparent.
Edge pixels are un-mixed from the background colour to avoid a grey halo.
"""
import argparse, datetime, io, os, sys, traceback
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import requests
from PIL import Image, ImageDraw, ImageFilter

from generate import fal, kind, load_manifest, raw_path, update_lock

BIREFNET = "fal-ai/birefnet"
HULL_TRIGGER = 0.20        # brief: >20 % of convex hull with alpha < 128
HOLE_MIN_FRAC = 0.002      # enclosed non-background holes larger than this share of the object
# An enclosed hole is refilled only when its raw colour is clearly not the
# background (dark interiors are 150+ away from light grey). Flux backgrounds
# have vignettes and paper grain, so pale gaps between stems sit 20-50 away
# and must stay transparent.
BG_DIST = 60.0
HOLE_MIN_ALPHA = 12.0      # mean birefnet alpha of a hole for it to count as "eaten interior"
# Landscape bands are keyed: the sky must be a flat light colour connected to the top edge.
KEY_BLUR, KEY_GRAD, KEY_DIST = 2.0, 5.0, 45.0


def label(mask: np.ndarray) -> tuple[np.ndarray, int]:
    """4-connected components of a boolean mask (run-length union-find, numpy only)."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    parent = [0]

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    prev_runs: list[tuple[int, int, int]] = []
    for y in range(h):
        row = mask[y]
        if not row.any():
            prev_runs = []
            continue
        d = np.diff(np.concatenate(([0], row.view(np.int8), [0])))
        starts, ends = np.flatnonzero(d == 1), np.flatnonzero(d == -1)
        runs = []
        j = 0
        for s, e in zip(starts, ends):
            ids = []
            while j < len(prev_runs) and prev_runs[j][1] <= s:
                j += 1
            k = j
            while k < len(prev_runs) and prev_runs[k][0] < e:
                ids.append(prev_runs[k][2])
                k += 1
            if ids:
                root = min(find(i) for i in ids)
                for i in ids:
                    parent[find(i)] = root
                lid = root
            else:
                lid = len(parent)
                parent.append(lid)
            lab[y, s:e] = lid
            runs.append((s, e, lid))
        prev_runs = runs
    roots = np.array([find(i) for i in range(len(parent))], np.int32)
    uniq, compact = np.unique(roots, return_inverse=True)
    return compact.astype(np.int32)[lab], len(uniq) - 1


def convex_hull_mask(mask: np.ndarray) -> np.ndarray:
    ys = np.flatnonzero(mask.any(axis=1))
    if len(ys) == 0:
        return mask.copy()
    pts = []
    for y in ys:
        xs = np.flatnonzero(mask[y])
        pts += [(int(xs[0]), int(y)), (int(xs[-1]), int(y))]
    pts = sorted(set(pts))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    im = Image.new("L", (mask.shape[1], mask.shape[0]), 0)
    if len(hull) >= 3:
        ImageDraw.Draw(im).polygon(hull, fill=255, outline=255)
    return np.asarray(im) > 0


def background_colour(rgb: np.ndarray) -> np.ndarray:
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]).astype(np.float32)
    return np.median(border, axis=0)


def repair(rgb: np.ndarray, alpha: np.ndarray) -> tuple[np.ndarray, dict]:
    """Return fixed alpha + stats. rgb uint8 HxWx3, alpha uint8 HxW."""
    solid = alpha >= 128
    hull = convex_hull_mask(solid)
    hull_px = int(hull.sum())
    hull_low = float((hull & ~solid).sum() / hull_px) if hull_px else 0.0
    bg = background_colour(rgb)
    lab, n = label(~solid)
    border_labels = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])).tolist()) - {0}
    obj_px = max(int(solid.sum()), 1)
    fill = np.zeros_like(solid)
    enclosed_px = kept_px = 0
    for comp in range(1, n + 1):
        if comp in border_labels:
            continue
        m = lab == comp
        cnt = int(m.sum())
        enclosed_px += cnt
        dist = float(np.linalg.norm(rgb[m].astype(np.float32).mean(axis=0) - bg))
        # birefnet's failure leaves *semi*-transparent interiors; a hole it cut to
        # ~0 with confidence is real background (e.g. inside a cable loop)
        if dist < BG_DIST or float(alpha[m].mean()) < HOLE_MIN_ALPHA:
            kept_px += cnt
        else:
            fill |= m
    fill_px = int(fill.sum())
    triggered = hull_low > HULL_TRIGGER or fill_px > HOLE_MIN_FRAC * obj_px
    out = alpha.copy()
    if triggered and fill_px:
        out[fill] = 255
    return out, {"hull_low_ratio": round(hull_low, 4), "enclosed_hole_px": enclosed_px,
                 "kept_bg_hole_px": kept_px, "filled_px": fill_px if triggered else 0,
                 "object_px": obj_px, "bg": [int(v) for v in bg]}


def defringe(rgb: np.ndarray, alpha: np.ndarray, bg: np.ndarray) -> np.ndarray:
    """Un-mix the background colour out of semi-transparent edge pixels."""
    a = alpha.astype(np.float32)[..., None] / 255.0
    edge = (alpha > 0) & (alpha < 255)
    c = rgb.astype(np.float32)
    un = (c - (1.0 - a) * bg) / np.maximum(a, 0.15)
    out = c.copy()
    out[edge] = np.clip(un[edge], 0, 255)
    return out.astype(np.uint8)


def key_sky(rgb: np.ndarray) -> tuple[np.ndarray, dict]:
    """Alpha for a landscape band: remove the flat sky connected to the top edge.

    birefnet returns an empty mask for landscapes (no salient object), so bands
    are generated under a plain light grey sky and keyed here instead.
    """
    s = np.asarray(Image.fromarray(rgb).filter(ImageFilter.GaussianBlur(KEY_BLUR))).astype(np.float32)
    grad = np.zeros(s.shape[:2], np.float32)
    dx = np.abs(np.diff(s, axis=1)).max(axis=2)
    dy = np.abs(np.diff(s, axis=0)).max(axis=2)
    grad[:, :-1] = np.maximum(grad[:, :-1], dx); grad[:, 1:] = np.maximum(grad[:, 1:], dx)
    grad[:-1] = np.maximum(grad[:-1], dy); grad[1:] = np.maximum(grad[1:], dy)
    top = s[: max(4, s.shape[0] // 50)].reshape(-1, 3)
    bg = np.median(top, axis=0)
    # tolerance from the sky's own noise (p90, robust to a summit poking into the top rows):
    # nano skies are flat to ~2 levels while pale pastel trees sit only 25-30 away
    noise = float(np.percentile(np.linalg.norm(top - bg, axis=1), 90))
    tol = float(np.clip(3 * noise + 6, 8, KEY_DIST))
    cand = (grad < KEY_GRAD) & (np.linalg.norm(s - bg, axis=2) < tol)
    lab, _ = label(cand)
    top_labels = np.setdiff1d(np.unique(lab[0]), [0])
    sky = np.isin(lab, top_labels)
    # soft edge from the un-blurred distance in a thin band around the sky
    zone = sky.copy()
    for _ in range(int(KEY_BLUR * 2) + 1):
        z = zone.copy()
        z[1:] |= zone[:-1]; z[:-1] |= zone[1:]; z[:, 1:] |= zone[:, :-1]; z[:, :-1] |= zone[:, 1:]
        zone = z
    zone &= ~sky
    d_raw = np.linalg.norm(rgb.astype(np.float32) - bg, axis=2)
    alpha = np.where(sky, 0, 255).astype(np.float32)
    alpha[zone] = 255 * np.clip((d_raw[zone] - tol) / 24, 0, 1)
    return alpha.astype(np.uint8), {"method": "key", "bg": [int(v) for v in bg], "tolerance": round(tol, 1),
                                    "sky_ratio": round(float(sky.mean()), 4)}


def cut_one(asset: dict) -> dict:
    src = raw_path(asset["id"])
    dest = raw_path(asset["id"], ".cut.png")
    if kind(asset) == "band":
        rgb = np.asarray(Image.open(src).convert("RGB"))
        a, stats = key_sky(rgb)
        rgb = defringe(rgb, a, np.array(stats["bg"], np.float32))
        Image.fromarray(np.dstack([rgb, a]), "RGBA").save(dest)
        info = {"model": "local sky key (cutout.py)", **stats,
                "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
        update_lock(asset["id"], lambda e: e.__setitem__("cutout", info))
        return info
    client = fal()
    url = client.upload_file(str(src))
    res = client.subscribe(BIREFNET, arguments={"image_url": url})
    out_url = res["image"]["url"]
    r = requests.get(out_url, timeout=120)
    r.raise_for_status()
    cut = Image.open(io.BytesIO(r.content)).convert("RGBA")
    raw = Image.open(src).convert("RGB")
    alpha = cut.getchannel("A")
    if alpha.size != raw.size:
        alpha = alpha.resize(raw.size, Image.LANCZOS)
    rgb = np.asarray(raw)
    a, stats = repair(rgb, np.asarray(alpha))
    rgb = defringe(rgb, a, np.array(stats["bg"], np.float32))
    tmp = dest.with_suffix(".tmp.png")
    Image.fromarray(np.dstack([rgb, a]), "RGBA").save(tmp)
    os.replace(tmp, dest)
    info = {"model": BIREFNET, "url": out_url, **stats,
            "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
    update_lock(asset["id"], lambda e: e.__setitem__("cutout", info))
    return info


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only")
    ap.add_argument("--force", action="append", default=[])
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args(argv)
    todo = []
    for a in load_manifest()["assets"]:
        if not a.get("cutout"):
            continue
        if args.force:
            if a["id"] in args.force:
                todo.append(a)
        elif (not args.only or a["id"].startswith(args.only)) and not raw_path(a["id"], ".cut.png").exists():
            todo.append(a)
    missing = [a["id"] for a in todo if not raw_path(a["id"]).exists()]
    todo = [a for a in todo if a["id"] not in missing]
    results = {i: ("FAIL", "no raw PNG") for i in missing}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(cut_one, a): a for a in todo}
        for f in as_completed(futs):
            a = futs[f]
            try:
                s = f.result()
                results[a["id"]] = ("OK", f"sky key, sky={s['sky_ratio']:.2f}" if s.get("method") == "key" else
                                    f"hull_low={s['hull_low_ratio']:.2f} filled={s['filled_px']} kept_bg_holes={s['kept_bg_hole_px']}")
            except Exception as e:
                results[a["id"]] = ("FAIL", repr(e)[:160])
                traceback.print_exc(limit=2, file=sys.stderr)
    for i, (st, d) in sorted(results.items()):
        print("%-34s %-4s %s" % (i, st, d))
    fails = sum(1 for s, _ in results.values() if s != "OK")
    print(f"\n{len(results) - fails} OK, {fails} FAIL")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
