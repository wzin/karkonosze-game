#!/usr/bin/env python3
"""fal.ai sound pipeline for "Basnie Karkonoszy".

    audio.py                 generate every clip that has no raw/audio/<id>.wav, process all
    audio.py --only ui/,mine/bell   restrict to ids / category prefixes
    audio.py --regen         delete the selected raw wavs first (re-roll them)
    audio.py --check         verify public/assets/audio and print a table

Reads audio_manifest.yaml, writes
    raw/audio/<id>.wav               raw model output (git-ignored)
    raw/audio.lock.json              model, prompt, seconds, url, peak dBFS, attempts (committed)
    ../../public/assets/audio/<id>.mp3 and manifest.json  (committed)

Per clip: model call (primary, fallback on exception) -> silence check (peak < -40 dBFS
re-rolls, max 3 attempts) -> loops: trim to whole seconds + 150 ms equal-power crossfade of
the tail onto the head -> ffmpeg loudnorm (two-pass, linear) -> libmp3lame -q:a 3.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime
import json
import math
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import threading
import time

import imageio_ffmpeg
import numpy as np
import requests
import soundfile as sf
import yaml

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
RAW = HERE / "raw" / "audio"
LOCK = HERE / "raw" / "audio.lock.json"
OUT = ROOT / "public" / "assets" / "audio"
SPEC = HERE / "audio_manifest.yaml"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

SILENCE_DBFS = -40.0
MAX_ATTEMPTS = 3
MAX_TOTAL_BYTES = 10 * 1024 * 1024
XFADE_S = 0.15
TARGETS = {"music": -20.0, "loop": -23.0, "ui": -18.0, "sfx": -16.0}  # LUFS

_print_lock = threading.Lock()


def log(msg: str) -> None:
    with _print_lock:
        print(msg, flush=True)


# ---------------------------------------------------------------- spec helpers
def load_spec() -> dict:
    return yaml.safe_load(SPEC.read_text(encoding="utf-8"))


def loudness_target(clip: dict) -> float:
    """music -20, background loops -23, UI -18, other effects -16 (LUFS)."""
    if clip["id"].startswith("music/") or clip["route"] == "music":
        return TARGETS["music"]
    if clip.get("loop"):
        return TARGETS["loop"]
    if clip["id"].startswith("ui/"):
        return TARGETS["ui"]
    return TARGETS["sfx"]


def request_seconds(clip: dict) -> int:
    """Seconds asked from the model (integer). Loops get +1 s so that, after the 150 ms
    crossfade eats the tail, a whole `seconds` remain."""
    s = math.ceil(clip["seconds"])
    return s + 1 if clip.get("loop") else s


# ---------------------------------------------------------------- audio maths
def peak_dbfs(x: np.ndarray) -> float:
    p = float(np.max(np.abs(x))) if x.size else 0.0
    return round(20 * math.log10(p), 2) if p > 1e-10 else -200.0


def make_loop(x: np.ndarray, sr: int, xfade_s: float = XFADE_S) -> np.ndarray:
    """Trim to a whole number of seconds and crossfade the last `xfade_s` onto the start,
    so that out[-1] -> out[0] continues the original waveform. x is (n, channels).
    Needs at least 1 s + xfade of audio; returns exactly k*sr samples."""
    xf = int(round(xfade_s * sr))
    whole = int(math.floor((len(x) - xf) / sr + 1e-9))
    if whole < 1:
        raise ValueError(f"clip too short to loop ({len(x) / sr:.2f}s)")
    n = whole * sr
    out = x[:n].copy()
    t = np.arange(xf) / xf
    fade_in = np.sin(t * math.pi / 2)[:, None]
    fade_out = np.cos(t * math.pi / 2)[:, None]
    out[:xf] = x[:xf] * fade_in + x[n:n + xf] * fade_out
    return out


def shape_oneshot(x: np.ndarray, sr: int, seconds: float) -> np.ndarray:
    """Trim to the requested length, with tiny fades so the cut never clicks."""
    n = min(len(x), int(round(seconds * sr)))
    out = x[:n].copy()
    fin = min(int(0.003 * sr), n // 2)
    fout = min(int(0.04 * sr), n // 4)
    if fin:
        out[:fin] *= np.linspace(0, 1, fin)[:, None]
    if fout:
        out[-fout:] *= np.linspace(1, 0, fout)[:, None]
    return out


# ---------------------------------------------------------------- ffmpeg
def _run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run([FFMPEG, "-hide_banner", "-nostats", *args],
                          capture_output=True, text=True)


def _last_json(text: str) -> dict:
    blocks = re.findall(r"\{[^{}]*\}", text, flags=re.S)
    if not blocks:
        raise ValueError("no loudnorm json in ffmpeg output")
    return json.loads(blocks[-1])


def encode_mp3(src_wav: pathlib.Path, dst: pathlib.Path, target: float) -> str:
    """Two-pass loudnorm (linear = one constant gain, so a loop seam stays seamless) ->
    mp3. Returns the normalization type ffmpeg reported for pass 2 ('linear'/'dynamic')."""
    base = f"I={target}:TP=-3:LRA=11"
    p1 = _run(["-i", str(src_wav), "-af", f"loudnorm={base}:print_format=json", "-f", "null", "-"])
    af = f"loudnorm={base}:print_format=json"
    try:
        m = _last_json(p1.stderr)
        vals = {k: float(m[k]) for k in ("input_i", "input_lra", "input_tp", "input_thresh", "target_offset")}
        if not all(math.isfinite(v) for v in vals.values()):
            raise ValueError("non-finite measurement")
        af = (f"loudnorm={base}:measured_I={vals['input_i']}:measured_LRA={vals['input_lra']}"
              f":measured_TP={vals['input_tp']}:measured_thresh={vals['input_thresh']}"
              f":offset={vals['target_offset']}:linear=true:print_format=json")
    except (ValueError, KeyError):
        pass  # fall back to single-pass dynamic loudnorm
    dst.parent.mkdir(parents=True, exist_ok=True)
    p2 = _run(["-y", "-i", str(src_wav), "-af", af, "-ar", "44100",
               "-c:a", "libmp3lame", "-q:a", "3", str(dst)])
    if p2.returncode != 0:
        raise RuntimeError(f"ffmpeg encode failed: {p2.stderr[-400:]}")
    try:
        return _last_json(p2.stderr).get("normalization_type", "?")
    except (ValueError, KeyError):
        return "?"


def decodes_ok(path: pathlib.Path) -> bool:
    r = subprocess.run([FFMPEG, "-v", "error", "-i", str(path), "-f", "null", "-"],
                       capture_output=True, text=True)
    return r.returncode == 0 and not r.stderr.strip()


def decode_pcm(path: pathlib.Path) -> tuple[np.ndarray, int]:
    sr = 44100
    r = subprocess.run([FFMPEG, "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2",
                        "-ar", str(sr), "pipe:1"], capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode(errors="replace")[-300:])
    return np.frombuffer(r.stdout, dtype=np.float32).reshape(-1, 2), sr


def integrated_lufs(path: pathlib.Path) -> float | None:
    r = _run(["-i", str(path), "-af", "ebur128=framelog=quiet", "-f", "null", "-"])
    hits = re.findall(r"^\s*I:\s*(-?[\d.]+|-inf)\s*LUFS", r.stderr, flags=re.M)
    try:
        return float(hits[-1])
    except (IndexError, ValueError):
        return None


# ---------------------------------------------------------------- fal.ai
_fal = None
_fal_lock = threading.Lock()


def fal():
    global _fal
    with _fal_lock:
        if _fal is None:
            sys.path.insert(0, str(HERE))
            from falkey import fal_key
            os.environ["FAL_KEY"] = fal_key()
            import fal_client
            _fal = fal_client
    return _fal


def call_model(model: str, prompt: str, seconds: int) -> str:
    """Returns the url of the generated wav. stable-audio takes seconds_total, the cassetteai
    fallbacks take duration; they answer {"audio": {"url"}} vs {"audio_file": {"url"}}."""
    args = {"prompt": prompt}
    args["seconds_total" if model.startswith("fal-ai/stable-audio") else "duration"] = seconds
    res = fal().subscribe(model, arguments=args)
    for key in ("audio", "audio_file"):
        node = res.get(key)
        if isinstance(node, dict) and node.get("url"):
            return node["url"]
    raise RuntimeError(f"no audio url in response: {json.dumps(res)[:200]}")


def download(url: str, dst: pathlib.Path) -> None:
    r = requests.get(url, timeout=180)
    r.raise_for_status()
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(".part")
    tmp.write_bytes(r.content)
    tmp.replace(dst)


def generate_raw(clip: dict, route: dict) -> dict:
    """Fetch a non-silent raw wav into raw/audio/<id>.wav. Returns provenance info."""
    wav = RAW / f"{clip['id']}.wav"
    secs = request_seconds(clip)
    errors: list[str] = []
    for attempt in range(1, MAX_ATTEMPTS + 1):
        used, url = None, None
        for model in (route["model"], route["fallback"]):
            try:
                url = call_model(model, clip["prompt"], secs)
                used = model
                break
            except Exception as e:  # noqa: BLE001 - any API/network failure -> next model
                errors.append(f"attempt {attempt} {model}: {type(e).__name__}: {str(e)[:120]}")
                log(f"  [{clip['id']}] {model} failed: {type(e).__name__}: {str(e)[:100]}")
        if url is None:
            time.sleep(2 * attempt)
            continue
        try:
            download(url, wav)
            data, _ = sf.read(wav, always_2d=True)
        except Exception as e:  # noqa: BLE001
            errors.append(f"attempt {attempt} download/read: {type(e).__name__}: {str(e)[:120]}")
            wav.unlink(missing_ok=True)
            continue
        peak = peak_dbfs(data)
        if peak < SILENCE_DBFS:
            log(f"  [{clip['id']}] silent ({peak} dBFS), re-rolling")
            errors.append(f"attempt {attempt} silent ({peak} dBFS)")
            wav.unlink(missing_ok=True)
            continue
        return {"model": used, "fallback_used": used != route["model"], "url": url,
                "seconds_requested": secs, "raw_peak_dbfs": peak, "attempts": attempt,
                "errors": errors}
    raise RuntimeError(f"gave up after {MAX_ATTEMPTS} attempts: {errors[-1] if errors else '?'}")


# ---------------------------------------------------------------- per-clip pipeline
def process_wav(clip: dict) -> dict:
    """raw wav -> (loop crossfade | one-shot trim) -> loudnorm -> mp3. Returns metrics."""
    wav = RAW / f"{clip['id']}.wav"
    data, sr = sf.read(wav, always_2d=True)
    data = data.astype(np.float32)
    if clip.get("loop"):
        shaped = make_loop(data, sr)
    else:
        shaped = shape_oneshot(data, sr, clip["seconds"])
    target = loudness_target(clip)
    dst = OUT / f"{clip['id']}.mp3"
    with tempfile.TemporaryDirectory(prefix="audio-") as td:
        tmp = pathlib.Path(td) / "shaped.wav"
        sf.write(tmp, shaped, sr, subtype="FLOAT")
        norm = encode_mp3(tmp, dst, target)
    if not decodes_ok(dst):
        raise RuntimeError("encoded mp3 does not decode cleanly")
    pcm, psr = decode_pcm(dst)
    return {"seconds_out": round(len(shaped) / sr, 2), "target_lufs": target,
            "final_peak_dbfs": peak_dbfs(pcm), "normalization": norm,
            "size_bytes": dst.stat().st_size}


def run_clip(clip: dict, spec: dict, prev: dict | None) -> dict:
    t0 = time.time()
    wav = RAW / f"{clip['id']}.wav"
    entry: dict = {}
    if wav.exists():
        data, _ = sf.read(wav, always_2d=True)
        peak = peak_dbfs(data)
        if peak >= SILENCE_DBFS:
            entry = dict(prev or {})  # keep provenance of the wav that is already on disk
            entry["raw_peak_dbfs"] = peak
        else:
            wav.unlink()
    if not wav.exists():
        entry = generate_raw(clip, spec["routes"][clip["route"]])
    entry.update({"prompt": clip["prompt"], "seconds": clip["seconds"],
                  "loop": bool(clip.get("loop")),
                  "generated_at": entry.get("generated_at") or datetime.date.today().isoformat()})
    entry.update(process_wav(clip))
    log(f"ok   {clip['id']:<18} {entry['seconds_out']:>5}s  peak {entry['final_peak_dbfs']:>6} dBFS"
        f"  {entry['size_bytes'] // 1024:>4} kB  ({'fallback ' if entry.get('fallback_used') else ''}"
        f"attempts={entry.get('attempts', '-')}, {time.time() - t0:.0f}s)")
    return entry


# ---------------------------------------------------------------- lock + manifest
def load_lock() -> dict:
    if LOCK.exists():
        return json.loads(LOCK.read_text(encoding="utf-8"))
    return {"clips": {}}


def save_lock(lock: dict) -> None:
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    LOCK.write_text(json.dumps(lock, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
                    encoding="utf-8")


def write_manifest(spec: dict, lock: dict) -> dict:
    clips = {}
    for c in spec["clips"]:
        entry = lock["clips"].get(c["id"])
        if entry and (OUT / f"{c['id']}.mp3").exists():
            clips[c["id"]] = {"src": f"audio/{c['id']}.mp3", "seconds": entry["seconds_out"],
                              "loop": bool(c.get("loop"))}
    manifest = {"clips": clips}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


# ---------------------------------------------------------------- commands
def select(spec: dict, only: str | None) -> list[dict]:
    if not only:
        return spec["clips"]
    wanted = [w.strip() for w in only.split(",") if w.strip()]
    return [c for c in spec["clips"] if any(c["id"] == w or c["id"].startswith(w) for w in wanted)]


def generate(args: argparse.Namespace) -> int:
    spec = load_spec()
    clips = select(spec, args.only)
    if args.regen:
        for c in clips:
            (RAW / f"{c['id']}.wav").unlink(missing_ok=True)
    lock = load_lock()
    failed: list[tuple[str, str]] = []
    log(f"{len(clips)} clips, {args.workers} workers")
    with cf.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(run_clip, c, spec, lock["clips"].get(c["id"])): c for c in clips}
        for fut in cf.as_completed(futs):
            c = futs[fut]
            try:
                lock["clips"][c["id"]] = fut.result()
                save_lock(lock)
            except Exception as e:  # noqa: BLE001 - tolerate per-clip failures
                failed.append((c["id"], f"{type(e).__name__}: {e}"))
                log(f"FAIL {c['id']}: {type(e).__name__}: {str(e)[:200]}")
    manifest = write_manifest(spec, lock)
    log(f"manifest: {len(manifest['clips'])}/{len(spec['clips'])} clips")
    for cid, why in failed:
        log(f"  left out: {cid} ({why[:160]})")
    return 1 if failed else 0


def check() -> int:
    spec = load_spec()
    mpath = OUT / "manifest.json"
    if not mpath.exists():
        print(f"no manifest at {mpath}")
        return 1
    clips = json.loads(mpath.read_text(encoding="utf-8"))["clips"]
    problems: list[str] = []
    rows, total = [], 0
    for cid, e in clips.items():
        f = ROOT / "public" / "assets" / e["src"]
        if not f.exists():
            problems.append(f"{cid}: file missing ({e['src']})")
            continue
        size = f.stat().st_size
        total += size
        if not decodes_ok(f):
            problems.append(f"{cid}: does not decode")
            continue
        pcm, sr = decode_pcm(f)
        secs, peak = round(len(pcm) / sr, 2), peak_dbfs(pcm)
        lufs = integrated_lufs(f)
        if peak < SILENCE_DBFS:
            problems.append(f"{cid}: silent (peak {peak} dBFS)")
        if peak > -1.0:
            problems.append(f"{cid}: peak {peak} dBFS too hot")
        if abs(secs - e["seconds"]) > 0.1:
            problems.append(f"{cid}: manifest says {e['seconds']}s, file decodes to {secs}s")
        rows.append((cid, secs, peak, lufs, size, e["loop"]))
    print(f"{'id':<20}{'seconds':>8}{'peak dBFS':>11}{'LUFS':>8}{'size kB':>9}  loop")
    for cid, secs, peak, lufs, size, loop in rows:
        ls = f"{lufs:.1f}" if lufs is not None else "?"
        print(f"{cid:<20}{secs:>8}{peak:>11}{ls:>8}{size / 1024:>9.0f}  {'loop' if loop else ''}")
    print(f"\n{len(rows)} clips, total {total / 1024 / 1024:.2f} MB (limit {MAX_TOTAL_BYTES // 1024 // 1024} MB)")
    if total > MAX_TOTAL_BYTES:
        problems.append(f"total size {total} B exceeds {MAX_TOTAL_BYTES} B")
    for c in spec["clips"]:
        if c["id"] not in clips:
            print(f"warning: {c['id']} is in audio_manifest.yaml but not in manifest.json")
    for p in problems:
        print(f"PROBLEM: {p}")
    print("check: " + ("FAILED" if problems else "OK"))
    return 1 if problems else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="verify public/assets/audio and print a table")
    ap.add_argument("--only", help="comma separated clip ids or category prefixes (e.g. ui/,mine/bell)")
    ap.add_argument("--regen", action="store_true", help="delete selected raw wavs and generate them again")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    return check() if args.check else generate(args)


if __name__ == "__main__":
    sys.exit(main())
