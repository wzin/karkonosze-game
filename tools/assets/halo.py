"""Halo check for keyed landscape bands: .venv/bin/python halo.py [--save]

For every `kind: band` asset, takes the packed WebP and reports which share of
opaque pixels (alpha >= 128) lying within 8 px of the keyed sky (alpha == 0)
are within dRGB 60 of the sky colour, i.e. a light rim that shows against a dark
backdrop. The same share 12-24 px inside is printed as a baseline: pale-painted
bands (morning palette) score high everywhere, a rim shows as edge >> interior.
--save also writes each band composited over #2a1f3d to raw/_contact/.
"""
import argparse, json, sys

import numpy as np
from PIL import Image

from generate import LOCK, RAW, load_manifest
from pack import OUT, mode

BACKDROP = (0x2A, 0x1F, 0x3D)
RADIUS, NEAR = 8, 60.0


def dilate(mask: np.ndarray, r: int) -> np.ndarray:
    out = mask.copy()
    for _ in range(r):
        z = out.copy()
        z[1:] |= out[:-1]; z[:-1] |= out[1:]; z[:, 1:] |= out[:, :-1]; z[:, :-1] |= out[:, 1:]
        out = z
    return out


def rim_share(rgba: np.ndarray, sky_rgb, lo: int = 0, hi: int = RADIUS) -> tuple[float, int]:
    """Share of opaque pixels lo..hi px from the keyed sky that are within NEAR of the sky colour."""
    a = rgba[..., 3]
    sky = a == 0
    ring = dilate(sky, hi) & ~(dilate(sky, lo) if lo else np.zeros_like(sky)) & (a >= 128)
    if not ring.any():
        return 0.0, 0
    d = np.linalg.norm(rgba[..., :3].astype(np.float32) - np.asarray(sky_rgb, np.float32), axis=2)
    return float((d[ring] < NEAR).mean()), int(ring.sum())


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--save", action="store_true")
    args = ap.parse_args(argv)
    lock = json.loads(LOCK.read_text())
    for a in load_manifest()["assets"]:
        if mode(a) != "band":
            continue
        im = Image.open(OUT / f"{a['id']}.webp").convert("RGBA")
        px, sky = np.asarray(im), lock[a["id"]]["cutout"]["bg"]
        share, n = rim_share(px, sky)
        base, _ = rim_share(px, sky, 12, 24)
        print(f"{a['id']:20s} edge 0-8 px: {share * 100:5.1f} %  (of {n} px)   interior 12-24 px: {base * 100:5.1f} %")
        if args.save:
            bg = Image.new("RGBA", im.size, BACKDROP + (255,))
            bg.alpha_composite(im)
            dest = RAW / "_contact" / f"halo_{a['id'].replace('/', '_')}.png"
            dest.parent.mkdir(parents=True, exist_ok=True)
            bg.convert("RGB").save(dest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
