"""Generate raw images for every asset in manifest.yaml via fal.ai.

    .venv/bin/python generate.py [--only PREFIX] [--force ID ...] [--note TEXT]
    .venv/bin/python generate.py --choose ID=N [--note TEXT]   # make attempt N the chosen one

Routes:
  flux (default) -> fal-ai/flux-pro/v1.1 (aspect-preserving request, see gen_size)
  ultra          -> fal-ai/flux-pro/v1.1-ultra (nearest aspect ratio, ~4 MP; flux for large plates)
  nano           -> fal-ai/nano-banana-pro (text-to-image, nearest aspect ratio, 1K/2K)
  edit           -> fal-ai/nano-banana-pro/edit with the ref's raw PNG,
                    fallback fal-ai/flux-pro/kontext
Writes raw/<id>.png (plus a copy raw/<id>.a<N>.png per attempt, so an earlier attempt can be
chosen again) and appends an attempt to raw/manifest.lock.json.
"""
import argparse, datetime, io, json, math, os, pathlib, shutil, sys, threading, traceback
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests, yaml
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
RAW = HERE / "raw"
LOCK = RAW / "manifest.lock.json"
MANIFEST = HERE / "manifest.yaml"

FLUX = "fal-ai/flux-pro/v1.1"
EDIT = "fal-ai/nano-banana-pro/edit"
EDIT_FALLBACK = "fal-ai/flux-pro/kontext"
NANO = "fal-ai/nano-banana-pro"  # route: nano, text-to-image, for subjects flux keeps getting wrong
ULTRA = "fal-ai/flux-pro/v1.1-ultra"  # route: ultra, flux at ~4 MP with an aspect ratio instead of a size
# fal's flux-pro/v1.1 clamps each side to 1440 and floors it to a multiple of 32
# without keeping the aspect ratio (1920x1080 comes back 1440x1056), so we ask
# for a size it will honour and resize to the target in pack.py.
FLUX_MAX_SIDE, FLUX_STEP, FLUX_MIN_SIDE, FLUX_TARGET_PX = 1440, 32, 256, 1.4e6

_lock_mutex = threading.Lock()


def load_manifest() -> dict:
    return yaml.safe_load(MANIFEST.read_text())


def target_size(asset: dict) -> tuple[int, int]:
    """Final packed size (before cutout trim)."""
    w, h = asset.get("out") or asset["size"]
    return int(w), int(h)


def kind(asset: dict) -> str:
    """Prompt framing: scene (full-frame picture), object (single subject, style without
    the word "scene"), band (landscape strip under a flat sky) or wisp (light mist on a flat
    black background, keyed by luminance). How the raw is processed afterwards follows
    `cutout` (see pack.mode)."""
    return asset.get("kind") or ("object" if asset.get("cutout") else "scene")


def full_prompt(asset: dict, m: dict) -> str:
    """Subject first, then framing, then the style sentence (see README, Decyzje).

    - scene:  prompt + style[...]                      (the brief's "layered paper-cut scene")
    - object: prompt + cutout_suffix + style_object[...] (no "scene" wording, it drags in landscapes)
    - band:   prompt + band_suffix + style[...]         (land strip under a flat grey sky, keyed out)
    - wisp:   prompt + wisp_suffix + style_object[...]  (mist on flat black, alpha from luminance)
    - route edit: prompt + edit_suffix only; a style sentence makes the edit model repaint the colours.
    """
    p = asset["prompt"]
    if asset.get("route") == "edit":
        return p + (m["edit_suffix_scene"] if kind(asset) == "scene" else m["edit_suffix"])
    k = kind(asset)
    if k == "band":
        p += m["band_suffix"]
        if asset.get("route") in ("nano", "ultra"):
            p += band_fraction_hint(asset)
    elif k == "wisp":
        p += m["wisp_suffix"]
    elif asset.get("cutout"):
        p += m["cutout_suffix"]
    style = m["style_object"] if k in ("object", "wisp") else m["style"]
    return f"{p} {style[asset['style']]}"


def gen_size(w: int, h: int) -> tuple[int, int]:
    """Largest flux-honoured size with the same aspect, about FLUX_TARGET_PX pixels."""
    s = min(FLUX_MAX_SIDE / max(w, h), math.sqrt(FLUX_TARGET_PX / (w * h)))
    snap = lambda v: max(FLUX_MIN_SIDE, min(FLUX_MAX_SIDE, int(round(v * s / FLUX_STEP)) * FLUX_STEP))
    return snap(w), snap(h)


def raw_path(asset_id: str, suffix: str = ".png") -> pathlib.Path:
    return RAW / f"{asset_id}{suffix}"


def read_lock() -> dict:
    return json.loads(LOCK.read_text()) if LOCK.exists() else {}


def update_lock(asset_id: str, fn) -> None:
    """Read-modify-write one entry of the lock file under a process-wide mutex."""
    with _lock_mutex:
        data = read_lock()
        entry = data.get(asset_id, {})
        fn(entry)
        data[asset_id] = entry
        data = dict(sorted(data.items()))
        LOCK.parent.mkdir(parents=True, exist_ok=True)
        tmp = LOCK.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
        os.replace(tmp, LOCK)


def fal():
    from falkey import fal_key
    os.environ.setdefault("FAL_KEY", fal_key())
    import fal_client
    return fal_client


def download_png(url: str, dest: pathlib.Path) -> tuple[int, int]:
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    im = Image.open(io.BytesIO(r.content))
    im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp.png")
    im.save(tmp)
    os.replace(tmp, dest)
    return im.size


def run_flux(asset: dict, prompt: str) -> dict:
    gw, gh = gen_size(*asset["size"])
    res = fal().subscribe(FLUX, arguments={
        "prompt": prompt, "image_size": {"width": gw, "height": gh}, "num_images": 1,
        "safety_tolerance": "5", "enable_safety_checker": False})
    return {"model": FLUX, "seed": res.get("seed"), "url": res["images"][0]["url"], "gen_size": [gw, gh]}


NANO_RATIOS = {"21:9": 21 / 9, "16:9": 16 / 9, "3:2": 1.5, "4:3": 4 / 3, "5:4": 1.25, "1:1": 1.0,
               "4:5": 0.8, "3:4": 0.75, "2:3": 2 / 3, "9:16": 9 / 16}


def nano_ratio(w: int, h: int) -> str:
    return min(NANO_RATIOS, key=lambda k: abs(math.log(NANO_RATIOS[k] / (w / h))))


def run_nano(asset: dict, prompt: str) -> dict:
    w, h = target_size(asset)
    ar = nano_ratio(w, h)
    res_name = "2K" if max(w, h) > 1024 or kind(asset) == "band" else "1K"
    res = fal().subscribe(NANO, arguments={"prompt": prompt, "num_images": 1, "aspect_ratio": ar,
                                           "resolution": res_name, "output_format": "png"})
    return {"model": NANO, "seed": res.get("seed"), "url": res["images"][0]["url"],
            "aspect_ratio": ar, "resolution": res_name}


ULTRA_RATIOS = ("21:9", "16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16")


def run_ultra(asset: dict, prompt: str) -> dict:
    w, h = target_size(asset)
    ar = min(ULTRA_RATIOS, key=lambda k: abs(math.log(NANO_RATIOS[k] / (w / h))))
    res = fal().subscribe(ULTRA, arguments={"prompt": prompt, "num_images": 1, "aspect_ratio": ar,
                                            "output_format": "png", "safety_tolerance": "5",
                                            "enable_safety_checker": False})
    return {"model": ULTRA, "seed": res.get("seed"), "url": res["images"][0]["url"], "aspect_ratio": ar}


def band_fraction_hint(asset: dict) -> str:
    """nano and ultra offer 21:9 at most; tell them to keep the land low so pack.py can crop the sky."""
    w, h = target_size(asset)
    frac = min(1.0, NANO_RATIOS[nano_ratio(w, h)] / (w / h))
    pct = int(frac * 85) // 5 * 5
    return f" The land occupies only the bottom {pct} percent of the picture." if pct < 85 else ""


def run_edit(asset: dict, prompt: str) -> dict:
    ref = raw_path(asset["ref"])
    if not ref.exists():
        raise RuntimeError(f"ref {asset['ref']} has no raw PNG yet")
    client = fal()
    ref_url = client.upload_file(str(ref))
    args = {"prompt": prompt, "image_urls": [ref_url], "num_images": 1}
    if kind(asset) == "scene":  # full-frame backgrounds: keep the ref's aspect, 2K so pack.py downsizes
        args.update(aspect_ratio="auto", resolution="2K")
    try:
        res = client.subscribe(EDIT, arguments=args)
        return {"model": EDIT, "seed": res.get("seed"), "url": res["images"][0]["url"], "ref_url": ref_url}
    except Exception as e:  # endpoint rejected the request -> documented fallback
        print(f"  {asset['id']}: {EDIT} failed ({e!r:.200}), falling back to {EDIT_FALLBACK}", flush=True)
        res = client.subscribe(EDIT_FALLBACK, arguments={"prompt": prompt, "image_url": ref_url})
        return {"model": EDIT_FALLBACK, "seed": res.get("seed"), "url": res["images"][0]["url"],
                "ref_url": ref_url, "fallback_reason": repr(e)[:300]}


def generate_one(asset: dict, m: dict, note: str | None) -> dict:
    prompt = full_prompt(asset, m)
    route = asset.get("route", "flux")
    result = {"edit": run_edit, "nano": run_nano, "flux": run_flux, "ultra": run_ultra}[route](asset, prompt)
    dest = raw_path(asset["id"])
    returned = download_png(result["url"], dest)
    cut = raw_path(asset["id"], ".cut.png")
    if cut.exists():  # stale cutout of a previous attempt
        cut.unlink()
    attempt = {**result, "prompt": prompt, "route": route, "size": list(target_size(asset)),
               "returned_size": list(returned),
               "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
    if note:
        attempt["note"] = note

    number = []

    def apply(entry):
        stash_repairs(entry)
        attempts = entry.get("attempts", []) + [attempt]
        number.append(len(attempts))
        entry.clear()
        entry.update({k: v for k, v in attempt.items() if k != "note"})
        entry["attempts"] = attempts
    update_lock(asset["id"], apply)
    shutil.copyfile(dest, raw_path(asset["id"], f".a{number[0]}.png"))
    return {**attempt, "number": number[0]}


def stash_repairs(entry: dict) -> None:
    """Top-level `repairs` (repair.py) belong to the chosen attempt: keep them on that attempt
    before the top of the entry is replaced by another attempt."""
    attempts = entry.get("attempts", [])
    if entry.get("repairs") and attempts:
        attempts[entry.get("chosen", len(attempts)) - 1]["repairs"] = entry["repairs"]


def choose(asset_id: str, n: int, note: str | None = None) -> dict:
    """Make attempt n (1-based) the chosen one again: restore its raw PNG, copy its fields to the
    top of the lock entry and drop the stale cutout.

    The raw must be the image the lock describes. A repaired attempt is restored from its last
    repair's url (repair.py rewrites raw/<id>.png after the per-attempt copy was taken, so that
    copy and the attempt url are the unrepaired image); otherwise from raw/<id>.a<N>.png, or the
    attempt url when there is no copy.
    """
    lock = read_lock()
    if asset_id not in lock:
        raise SystemExit(f"--choose: {asset_id!r} has no entry in {LOCK.name}")
    entry = lock[asset_id]
    stash_repairs(entry)
    attempts = entry.get("attempts", [])
    if not 1 <= n <= len(attempts):
        raise SystemExit(f"--choose: {asset_id} has attempts 1..{len(attempts)}, not {n}")
    at = attempts[n - 1]
    dest, copy = raw_path(asset_id), raw_path(asset_id, f".a{n}.png")
    if at.get("repairs"):
        download_png(at["repairs"][-1]["url"], dest)
    elif copy.exists():
        shutil.copyfile(copy, dest)
    else:
        download_png(at["url"], dest)
    raw_path(asset_id, ".cut.png").unlink(missing_ok=True)

    def apply(entry):
        stash_repairs(entry)
        kept = entry["attempts"]
        entry.clear()
        entry.update({k: v for k, v in at.items() if k not in ("note", "repairs")})
        if at.get("repairs"):
            entry["repairs"] = at["repairs"]
        entry["attempts"] = kept
        entry["chosen"] = n
        if note:
            entry["chosen_note"] = note
    update_lock(asset_id, apply)
    return at


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="only asset ids starting with this prefix")
    ap.add_argument("--force", action="append", default=[], help="regenerate this id even if raw exists (repeatable)")
    ap.add_argument("--note", help="reason for this (re)generation, stored in the lock attempt")
    ap.add_argument("--choose", action="append", default=[], metavar="ID=N",
                    help="make attempt N (1-based, see the lock) the chosen one again; no generation")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args(argv)

    m = load_manifest()
    if args.choose:
        for spec in args.choose:
            aid, sep, n = spec.rpartition("=")
            if not (sep and aid and n.isdigit()):
                raise SystemExit(f"--choose expects ID=N with N an attempt number from 1, got {spec!r}")
            at = choose(aid, int(n), args.note)
            print(f"chose {aid} attempt {n}: {at['model']} {at.get('returned_size')}")
        return 0
    ids = {a["id"] for a in m["assets"]}
    unknown = [f for f in args.force if f not in ids]
    if unknown:
        raise SystemExit(f"unknown --force ids: {unknown}")
    if args.force:  # a re-roll touches only the named ids
        todo = [a for a in m["assets"] if a["id"] in args.force]
    else:
        todo = [a for a in m["assets"]
                if (not args.only or a["id"].startswith(args.only)) and not raw_path(a["id"]).exists()]
    if not todo:
        print("nothing to generate")
        return 0
    # edit-route assets need their ref's raw PNG, so they go in a second wave
    waves = [[a for a in todo if a.get("route", "flux") != "edit"],
             [a for a in todo if a.get("route", "flux") == "edit"]]
    results: dict[str, tuple[str, str]] = {}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for wave in waves:
            futs = {pool.submit(generate_one, a, m, args.note): a for a in wave}
            for f in as_completed(futs):
                a = futs[f]
                try:
                    at = f.result()
                    results[a["id"]] = ("OK", f"#{at['number']} {at['model']} {at['returned_size'][0]}x{at['returned_size'][1]} seed={at.get('seed')}")
                    print(f"OK   {a['id']}", flush=True)
                except Exception as e:
                    results[a["id"]] = ("FAIL", repr(e)[:160])
                    print(f"FAIL {a['id']}: {e!r:.300}", flush=True)
                    traceback.print_exc(limit=2, file=sys.stderr)
    print("\n%-34s %-4s %s" % ("id", "", "detail"))
    for a in todo:
        st, detail = results.get(a["id"], ("FAIL", "not run"))
        print("%-34s %-4s %s" % (a["id"], st, detail))
    fails = sum(1 for s, _ in results.values() if s != "OK")
    print(f"\n{len(todo) - fails} OK, {fails} FAIL")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
