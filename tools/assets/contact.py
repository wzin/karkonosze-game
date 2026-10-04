"""Contact sheets for visual review: .venv/bin/python contact.py [--only PREFIX] [--cut | --packed] [--out DIR]

Writes grids of labelled thumbnails to raw/_contact/ (ignored by git): raw/<id>.png,
raw/<id>.cut.png with --cut, or the packed public/assets/gfx/<id>.webp with --packed
(transparency shown over a magenta/green checkerboard).
"""
import argparse, pathlib
from PIL import Image, ImageDraw

from generate import HERE, RAW, load_manifest

PACKED = HERE.parent.parent / "public" / "assets" / "gfx"

TILE, COLS, ROWS = 480, 3, 3


def checker(size, sq=16):
    im = Image.new("RGB", size, (200, 60, 200))
    d = ImageDraw.Draw(im)
    for y in range(0, size[1], sq):
        for x in range(0, size[0], sq):
            if (x // sq + y // sq) % 2:
                d.rectangle([x, y, x + sq - 1, y + sq - 1], fill=(40, 160, 60))
    return im


def tile(path: pathlib.Path, label: str, cut: bool) -> Image.Image:
    t = Image.new("RGB", (TILE, TILE + 22), (30, 30, 30))
    if path.exists():
        im = Image.open(path)
        im.thumbnail((TILE, TILE))
        if cut:
            bg = checker(im.size)
            bg.paste(im, (0, 0), im.convert("RGBA"))
            im = bg
        t.paste(im.convert("RGB"), ((TILE - im.width) // 2, (TILE - im.height) // 2))
    else:
        label += " (missing)"
    ImageDraw.Draw(t).text((6, TILE + 4), label, fill=(255, 255, 255))
    return t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--cut", action="store_true")
    ap.add_argument("--packed", action="store_true", help="the WebP files pack.py wrote")
    ap.add_argument("--out", default=str(RAW / "_contact"))
    args = ap.parse_args()
    assets = [a for a in load_manifest()["assets"]
              if (not args.only or a["id"].startswith(args.only)) and (a.get("cutout") or not args.cut)]
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    per = COLS * ROWS
    for i in range(0, len(assets), per):
        chunk = assets[i:i + per]
        sheet = Image.new("RGB", (COLS * TILE, ((len(chunk) - 1) // COLS + 1) * (TILE + 22)), (0, 0, 0))
        for j, a in enumerate(chunk):
            if args.packed:
                p = PACKED / f"{a['id']}.webp"
            else:
                p = RAW / f"{a['id']}{'.cut.png' if args.cut else '.png'}"
            sheet.paste(tile(p, a["id"], args.cut or args.packed), ((j % COLS) * TILE, (j // COLS) * (TILE + 22)))
        kind_ = "packed" if args.packed else ("cut" if args.cut else "raw")
        name = out / f"{kind_}_{(args.only or 'all').replace('/', '_')}_{i // per}.png"
        sheet.save(name)
        print(name)


if __name__ == "__main__":
    main()
