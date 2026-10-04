"""Pack raw images into WebP + public/assets/gfx/manifest.json.

    .venv/bin/python pack.py            # pack everything, then run the checks
    .venv/bin/python pack.py --check    # checks only (works without raw/, e.g. in CI)

Per asset (target = `out` or `size` from manifest.yaml):
  scene  -> raw/<id>.png, cover-fit to the target, WebP q84, no alpha
  object -> raw/<id>.cut.png, trim to the alpha bbox at raw resolution, fit into the target box
            (never upscaling the raw), 8 px transparent margin, WebP q88
  band   -> raw/<id>.cut.png, fit to the target width, trim the keyed sky, crop the bottom
            if still taller than the target (nearer layers cover it), WebP q88
Frames that share a `ref` (route: edit) share one union bbox and scale, so they stay aligned.
"""
import argparse, json, pathlib, sys

from PIL import Image, ImageOps

from generate import HERE, kind, load_manifest, raw_path, target_size

ROOT = HERE.parent.parent
OUT = ROOT / "public" / "assets" / "gfx"
MANIFEST_JSON = OUT / "manifest.json"
MARGIN, ALPHA_MIN = 8, 3
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


def pack_scene(asset: dict) -> Image.Image:
    return ImageOps.fit(Image.open(source(asset)).convert("RGB"), target_size(asset), Image.LANCZOS)


def pack_band(asset: dict) -> Image.Image:
    tw, th = target_size(asset)
    im = Image.open(source(asset)).convert("RGBA")
    im = resize_rgba(im, (tw, max(1, round(im.height * tw / im.width))))
    box = alpha_bbox(im)
    top = max(0, box[1] - MARGIN) if box else 0
    return im.crop((0, top, tw, min(im.height, top + th)))


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
