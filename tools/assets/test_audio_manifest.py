"""Sanity tests for audio_manifest.yaml (no network, no audio)."""
import pathlib
import re

import yaml

HERE = pathlib.Path(__file__).parent
MANIFEST = yaml.safe_load((HERE / "audio_manifest.yaml").read_text(encoding="utf-8"))
CLIPS = MANIFEST["clips"]
ROUTES = MANIFEST["routes"]


def test_ids_unique():
    ids = [c["id"] for c in CLIPS]
    assert len(ids) == len(set(ids))


def test_ids_are_category_slash_name():
    for c in CLIPS:
        assert re.fullmatch(r"[a-z]+/[a-z0-9_]+", c["id"]), c["id"]


def test_expected_clip_count():
    # The brief says "34 clips" but its verbatim YAML list has 33 (5 music, 4 ui,
    # 6 glass, 5 turnips, 7 mine, 6 herbs). The YAML is authoritative.
    assert len(CLIPS) == 33


def test_seconds_in_range():
    for c in CLIPS:
        assert 0.5 <= c["seconds"] <= 60, c["id"]


def test_every_route_defined():
    for c in CLIPS:
        assert c["route"] in ROUTES, c["id"]


def test_routes_have_model_and_fallback():
    for name, r in ROUTES.items():
        assert r.get("model") and r.get("fallback"), name


def test_loop_only_with_seconds_at_least_4():
    for c in CLIPS:
        if c.get("loop"):
            assert c["seconds"] >= 4, c["id"]


def test_every_clip_has_prompt():
    for c in CLIPS:
        assert isinstance(c.get("prompt"), str) and c["prompt"].strip(), c["id"]


# ---- pure helpers of audio.py (no network) -------------------------------------------
import numpy as np  # noqa: E402

import audio  # noqa: E402


def test_loudness_targets():
    by_id = {c["id"]: c for c in CLIPS}
    assert audio.loudness_target(by_id["music/hub"]) == -20
    assert audio.loudness_target(by_id["glass/furnace"]) == -23  # looped background
    assert audio.loudness_target(by_id["ui/tap"]) == -18
    assert audio.loudness_target(by_id["glass/pop"]) == -16


def test_loop_is_whole_seconds_and_seam_is_continuous():
    sr = 8000
    rng = np.random.default_rng(1)
    x = np.cumsum(rng.normal(size=(sr * 5, 2)), axis=0).astype(np.float32)
    x /= np.abs(x).max()
    out = audio.make_loop(x, sr)
    # 5 s raw -> 4 s loop (the 150 ms crossfade eats the tail)
    assert len(out) % sr == 0 and len(out) == 4 * sr
    n = len(out)
    # the wrap-around step equals the original adjacent-sample step
    assert np.allclose(out[0] - out[-1], x[n] - x[n - 1], atol=1e-6)


def test_oneshot_is_trimmed_and_faded():
    sr = 8000
    x = np.ones((sr * 3, 2), dtype=np.float32)
    out = audio.shape_oneshot(x, sr, 0.8)
    assert len(out) == int(0.8 * sr)
    assert out[0, 0] == 0 and abs(out[-1, 0]) < 0.05
