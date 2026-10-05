"""Pack raw images into WebP + public/assets/gfx/manifest.json.

    .venv/bin/python pack.py            # pack everything, then run the checks
    .venv/bin/python pack.py --check    # checks only (works without raw/, e.g. in CI)

Per asset (target = `out` or `size` from manifest.yaml):
  scene  -> raw/<id>.png, light paper margin cropped (see paper_margin), cover-fit to the target,
            WebP q84, no alpha
  object -> raw/<id>.cut.png, trim to the alpha bbox at raw resolution, fit into the target box
            (never upscaling the raw), 8 px transparent margin, WebP q88
  band   -> raw/<id>.cut.png, keyed-out paper margins at the sides and bottom cropped (see
            band_margin), fit to the target width, trim the keyed sky, crop the bottom if still
            taller than the target (nearer layers cover it), WebP q88
  wisp   -> packed like an object (raw/<id>.cut.png from the luma key)
Frames that share a `ref` (route: edit) share one union bbox and scale, so they stay aligned.
`fade_x: true` (or a fraction of the width, default 0.25) multiplies the packed alpha by a
smoothstep ramp at the left and right ends, so a mist wisp has no visible ends.
"""
import argparse, json, pathlib, sys

import numpy as np
from PIL import Image, ImageOps

from generate import HERE, kind, load_manifest, raw_path, target_size

ROOT = HERE.parent.parent
OUT = ROOT / "public" / "assets" / "gfx"
MANIFEST_JSON = OUT / "manifest.json"
MARGIN, ALPHA_MIN = 8, 3
FADE_X = 0.25              # fade_x: true -> each end fades over this share of the width
# nano-banana-pro sometimes paints the picture on a sheet of paper with a light margin around it
PAPER_TOL, PAPER_MAX, PAPER_INSET, PAPER_MIN_LUMA = 20.0, 0.08, 6, 170.0
BAND_MARGIN_MAX, BAND_SOLID, BAND_INSET_MAX = 0.06, 0.97, 0.01
LUMA = np.array([0.299, 0.587, 0.114], np.float32)
BUDGET_BYTES, MAX_SIDE = 40 * 1024 * 1024, 4096


def resize_rgba(im: Image.Image, size) -> Image.Image:
    # premultiplied resize so transparent pixels do not bleed colour into edges
    return im.convert("RGBa").resize(size, Image.LANCZOS).convert("RGBA")


def alpha_bbox(im: Image.Image):
    return im.getchannel("A").point(lambda v: 255 if v >= ALPHA_MIN else 0).getbbox()


def mode(asset: dict) -> str:
    """How the raw is processed: scene (opaque), band (keyed strip) or object (birefnet cutout)."""
    if not asset.get("cutout"):
        return "scene"
    return "band" if kind(asset) == "band" else "object"


def source(asset: dict):
    return raw_path(asset["id"], ".png" if mode(asset) == "scene" else ".cut.png")


def paper_margin(rgb: np.ndarray):
    """(left, top, right, bottom) px of a flat light paper margin around a painting, or None.

    A line counts as paper when >= 90 % of its pixels are within PAPER_TOL of the corner
    colour. Only a light colour on all four sides is a margin (a flat dark sky along the
    top alone is not); PAPER_INSET more px go with it, to drop the ragged painted edge.
    """
    h, w = rgb.shape[:2]
    c = rgb.astype(np.float32)
    k = 8
    corners = np.concatenate([c[:k, :k].reshape(-1, 3), c[:k, -k:].reshape(-1, 3),
                              c[-k:, :k].reshape(-1, 3), c[-k:, -k:].reshape(-1, 3)])
    paper = np.median(corners, axis=0)
    if float(paper @ LUMA) < PAPER_MIN_LUMA:
        return None
    near = np.linalg.norm(c - paper, axis=2) < PAPER_TOL

    def run(lines):
        n = 0
        for line in lines:
            if line.mean() < 0.9:
                break
            n += 1
        return n
    lx, ly = int(w * PAPER_MAX), int(h * PAPER_MAX)
    m = (run(near[:, x] for x in range(lx)), run(near[y] for y in range(ly)),
         run(near[:, w - 1 - x] for x in range(lx)), run(near[h - 1 - y] for y in range(ly)))
    if min(m) < 3:
        return None
    return tuple(v + PAPER_INSET for v in m)


def pack_scene(asset: dict) -> Image.Image:
    im = Image.open(source(asset)).convert("RGB")
    m = paper_margin(np.asarray(im))
    if m:
        im = im.crop((m[0], m[1], im.width - m[2], im.height - m[3]))
    return ImageOps.fit(im, target_size(asset), Image.LANCZOS)


def band_margin(alpha: np.ndarray) -> tuple[int, int, int]:
    """(x0, x1, y1) of the solid land in a keyed band whose land does not reach the sides or
    the bottom (painted as a picture on paper: the margin was keyed out with the sky).

    Coverage is measured over the land's lower rows (rows more than half opaque, lower two
    thirds of them). Leading columns / trailing rows under 50 % opaque are the margin; up to
    BAND_INSET_MAX more go with them until the land is BAND_SOLID opaque (the ragged edge).
    A band that touches its edges, or a "margin" wider than BAND_MARGIN_MAX, is left alone.
    """
    h, w = alpha.shape
    op = alpha >= 250
    rows = np.flatnonzero(op.mean(axis=1) > 0.5)
    if len(rows) < 3:
        return 0, w, h

    def cut(cov: np.ndarray, limit: int, inset: int) -> int:
        n = 0
        while n < len(cov) and cov[n] < 0.5:
            n += 1
        if n == 0 or n > limit:
            return 0
        k = 0
        while n + k < len(cov) and cov[n + k] < BAND_SOLID and k < inset:
            k += 1
        return n + k
    col = op[rows[len(rows) // 3:]].mean(axis=0)
    lim, ins = int(w * BAND_MARGIN_MAX), max(1, int(w * BAND_INSET_MAX))
    x0, x1 = cut(col, lim, ins), w - cut(col[::-1], lim, ins)
    row = op[:, x0:x1].mean(axis=1)
    y1 = h - cut(row[::-1], int(h * BAND_MARGIN_MAX * 2), max(1, int(h * BAND_INSET_MAX)))
    return x0, x1, y1


def pack_band(asset: dict) -> Image.Image:
    tw, th = target_size(asset)
    im = Image.open(source(asset)).convert("RGBA")
    x0, x1, y1 = band_margin(np.asarray(im.getchannel("A")))
    im = im.crop((x0, 0, x1, y1))
    im = resize_rgba(im, (tw, max(1, round(im.height * tw / im.width))))
    box = alpha_bbox(im)
    top = max(0, box[1] - MARGIN) if box else 0
    return im.crop((0, top, tw, min(im.height, top + th)))


def fade_x(im: Image.Image, frac: float = FADE_X) -> Image.Image:
    """Multiply the alpha by a smoothstep ramp from 0 at the left/right edge to 1 at frac*width in."""
    rgba = np.array(im.convert("RGBA"))
    x = (np.arange(im.width, dtype=np.float32) + 0.5) / im.width
    t = np.clip(np.minimum(x, 1.0 - x) / frac, 0.0, 1.0)
    ramp = t * t * (3.0 - 2.0 * t)
    rgba[..., 3] = np.round(rgba[..., 3].astype(np.float32) * ramp[None, :]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def fade_fraction(asset: dict) -> float | None:
    v = asset.get("fade_x")
    if not v:
        return None
    return FADE_X if v is True else float(v)


def pack_objects(group: list[dict]) -> dict[str, Image.Image]:
    """Trim to the alpha bbox at raw resolution, then fit into the target box minus the margin.

    Members of an animation group are first brought to a common canvas (contain-fit
    into the target), share one union bbox and one scale, so frames stay aligned.
    Never upscales past the raw pixels.
    """
    tw, th = target_size(group[0])
    raws = {a["id"]: Image.open(source(a)).convert("RGBA") for a in group}
    norm = {i: min(tw / im.width, th / im.height) for i, im in raws.items()}  # raw -> common canvas
    # members are centred on the canvas (edit outputs can differ slightly in aspect)
    off = {i: ((tw - im.width * norm[i]) / 2, (th - im.height * norm[i]) / 2) for i, im in raws.items()}
    boxes = []
    for i, im in raws.items():
        b = alpha_bbox(im)
        if b:
            ox, oy = off[i]
            boxes.append((b[0] * norm[i] + ox, b[1] * norm[i] + oy, b[2] * norm[i] + ox, b[3] * norm[i] + oy))
    if not boxes:
        return {i: im for i, im in raws.items()}
    x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    bw, bh = x1 - x0, y1 - y0
    f = min((tw - 2 * MARGIN) / bw, (th - 2 * MARGIN) / bh, min(1 / n for n in norm.values()))
    cw, ch = max(1, round(bw * f)), max(1, round(bh * f))
    out = {}
    for i, im in raws.items():
        n, (ox, oy) = norm[i], off[i]
        crop = im.crop((round((x0 - ox) / n), round((y0 - oy) / n), round((x1 - ox) / n), round((y1 - oy) / n)))
        canvas = Image.new("RGBA", (cw + 2 * MARGIN, ch + 2 * MARGIN), (0, 0, 0, 0))
        canvas.alpha_composite(resize_rgba(crop, (cw, ch)), (MARGIN, MARGIN))
        out[i] = canvas
    return out


def pack() -> int:
    """Repack every asset whose raw source exists and merge into the existing manifest.json.

    raw/ is not committed, so on a clean clone (or with a partial raw/) entries
    without a source keep their committed WebP and manifest entry. Animation
    frames are repacked only when every frame of the group has a source, so they
    keep sharing one bbox. Entries for ids no longer in manifest.yaml are dropped.
    """
    assets = load_manifest()["assets"]
    by_id = {a["id"]: a for a in assets}
    existing = json.loads(MANIFEST_JSON.read_text())["assets"] if MANIFEST_JSON.exists() else {}
    # animation frames: an edit-route asset and its ref are packed together
    group_of: dict[str, list[str]] = {}
    for a in assets:
        if a.get("route") == "edit" and a.get("ref"):
            g = group_of.setdefault(a["ref"], [a["ref"]])
            g.append(a["id"])
            group_of[a["id"]] = g
    has_src = {a["id"] for a in assets if source(a).exists()}
    available = {i for i in has_src if all(m in has_src for m in group_of.get(i, [i]))}
    images: dict[str, Image.Image] = {}
    for a in assets:
        aid = a["id"]
        if aid not in available or aid in images:
            continue
        m = mode(a)
        if m == "scene":
            images[aid] = pack_scene(a)
        elif m == "band":
            images[aid] = pack_band(a)
        else:
            images.update(pack_objects([by_id[i] for i in group_of.get(aid, [aid])]))
    for a in assets:
        frac = fade_fraction(a)
        if frac and a["id"] in images:
            images[a["id"]] = fade_x(images[a["id"]], frac)
    entries, kept, missing = {}, [], []
    for a in assets:
        aid = a["id"]
        if aid not in images:
            if aid in existing:
                entries[aid] = existing[aid]
                kept.append(aid)
            else:
                missing.append(aid)
            continue
        im = images[aid]
        dest = OUT / f"{aid}.webp"
        dest.parent.mkdir(parents=True, exist_ok=True)
        if mode(a) == "scene":
            im.save(dest, "WEBP", quality=84, method=6)
        else:
            im.save(dest, "WEBP", quality=88, method=6)
        entries[aid] = {"src": f"gfx/{aid}.webp", "w": im.width, "h": im.height}
        print(f"{aid:34s} {im.width:5d}x{im.height:<5d} {dest.stat().st_size / 1024:8.1f} KB")
    dropped = sorted(set(existing) - set(by_id))
    MANIFEST_JSON.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_JSON.write_text(json.dumps({"assets": entries}, indent=1, ensure_ascii=False) + "\n")
    print(f"\nrepacked {len(images)}, kept {len(kept)} existing entries (no raw source)"
          + (f", dropped {len(dropped)} not in manifest.yaml: {', '.join(dropped)}" if dropped else ""))
    if missing:
        print(f"MISSING: no raw source and no existing entry for {len(missing)} assets: {', '.join(missing)}")
    return 1 if missing else 0


def check() -> int:
    errors = []
    if not MANIFEST_JSON.exists():
        print(f"FAIL: {MANIFEST_JSON} does not exist")
        return 1
    entries = json.loads(MANIFEST_JSON.read_text())["assets"]
    expected = {a["id"] for a in load_manifest()["assets"]}
    for i in sorted(expected - set(entries)):
        errors.append(f"{i}: in manifest.yaml but not packed")
    total = 0
    for aid, e in entries.items():
        if e["src"] != f"gfx/{aid}.webp":
            errors.append(f"{aid}: src {e['src']!r} does not match its id")
        f = OUT.parent / e["src"]
        if not f.exists():
            errors.append(f"{aid}: missing file {f}")
            continue
        total += f.stat().st_size
        with Image.open(f) as im:
            if im.size != (e["w"], e["h"]):
                errors.append(f"{aid}: manifest says {e['w']}x{e['h']}, file is {im.width}x{im.height}")
            if max(im.size) > MAX_SIDE:
                errors.append(f"{aid}: side {max(im.size)} > {MAX_SIDE}")
    if total > BUDGET_BYTES:
        errors.append(f"total {total / 2**20:.2f} MB > {BUDGET_BYTES / 2**20:.0f} MB")
    for e in errors:
        print("FAIL:", e)
    print(f"{len(entries)} assets, total {total / 2**20:.2f} MB (budget {BUDGET_BYTES / 2**20:.0f} MB)"
          + ("" if errors else ", OK"))
    return 1 if errors else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="only verify the packed output")
    args = ap.parse_args(argv)
    if args.check:
        return check()
    rc = pack()
    return check() or rc


if __name__ == "__main__":
    sys.exit(main())
