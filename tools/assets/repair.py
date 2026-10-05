"""Repair a raw image whose subject is clipped by the top edge (outpaint with nano-banana-pro/edit).

    .venv/bin/python repair.py ID --shift-down PX --prompt TEXT

The raw is moved down by PX on a canvas of the same size (the new top strip is
filled with the median colour of the old top row, the bottom PX rows are
dropped), then the edit model paints the missing part. The result replaces
raw/<id>.png; the step is recorded under "repairs" in raw/manifest.lock.json
(it is not a new attempt: the chosen attempt stays the same; generate.py moves the
record onto that attempt when another one is generated or chosen, and `--choose` restores a
repaired attempt from the repair's url). Re-run cutout.py --force ID afterwards.
"""
import argparse, datetime, math, sys

import numpy as np
from PIL import Image

from generate import EDIT, NANO_RATIOS, download_png, fal, raw_path, update_lock


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("id")
    ap.add_argument("--shift-down", type=int, required=True)
    ap.add_argument("--prompt", required=True)
    args = ap.parse_args(argv)
    src = raw_path(args.id)
    im = Image.open(src).convert("RGB")
    top = np.median(np.asarray(im)[0], axis=0).astype(np.uint8)
    canvas = Image.new("RGB", im.size, tuple(int(v) for v in top))
    canvas.paste(im.crop((0, 0, im.width, im.height - args.shift_down)), (0, args.shift_down))
    shifted = src.with_name(src.stem + ".shifted.png")
    canvas.save(shifted)
    client = fal()
    url = client.upload_file(str(shifted))
    ar = min(NANO_RATIOS, key=lambda k: abs(math.log(NANO_RATIOS[k] / (im.width / im.height))))
    res = client.subscribe(EDIT, arguments={"prompt": args.prompt, "image_urls": [url], "num_images": 1,
                                            "aspect_ratio": ar, "resolution": "2K", "output_format": "png"})
    out_url = res["images"][0]["url"]
    size = download_png(out_url, src)
    info = {"model": EDIT, "prompt": args.prompt, "shift_down": args.shift_down, "input_url": url,
            "url": out_url, "returned_size": list(size),
            "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
    update_lock(args.id, lambda e: (e.setdefault("repairs", []).append(info), e.pop("cutout", None)))
    raw_path(args.id, ".cut.png").unlink(missing_ok=True)
    print("repaired", args.id, size)
    return 0


if __name__ == "__main__":
    sys.exit(main())
