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


def test_loop_gain_is_limited_by_loudness_or_true_peak():
    # quiet, safe clip: the loudness target decides (-30 LUFS -> +10 dB, peak -20 -> -10, under -3)
    assert audio.loop_gain_db(-30.0, -20.0, -20.0) == 10.0
    # high crest factor: the -3 dBTP ceiling decides (-30 LUFS wants +10 dB, peak -8 allows +5 dB)
    assert audio.loop_gain_db(-30.0, -8.0, -20.0) == 5.0
    # the resulting peak never passes the ceiling
    for i, tp, target in [(-14.0, -1.0, -23.0), (-40.0, -35.0, -20.0), (-25.0, -12.0, -20.0)]:
        assert tp + audio.loop_gain_db(i, tp, target) <= audio.TP_CEILING + 1e-9


def test_loop_gain_refuses_silence():
    import pytest
    with pytest.raises(ValueError):
        audio.loop_gain_db(float("-inf"), float("-inf"), -20.0)


def test_loop_gain_step_detects_a_ramp_but_not_a_constant_gain():
    sr = 8000
    rng = np.random.default_rng(2)
    x = rng.normal(scale=0.1, size=(sr * 6, 2)).astype(np.float32)
    constant = x * 0.5
    assert abs(audio.loop_gain_step_db(x, constant, sr)) < 0.01
    ramp = x * np.linspace(1.0, 2.0, len(x), dtype=np.float32)[:, None]  # +6 dB head to tail
    assert audio.loop_gain_step_db(x, ramp, sr) > 4.0


def test_manifest_problems_reports_a_yaml_id_missing_from_manifest_json():
    spec = {"clips": [{"id": "ui/tap", "loop": False}, {"id": "ui/star"}]}
    assert audio.manifest_problems(spec, {"ui/tap": {"loop": False}, "ui/star": {"loop": False}}) == []
    problems = audio.manifest_problems(spec, {"ui/tap": {"loop": False}})
    assert len(problems) == 1 and "ui/star" in problems[0] and "missing" in problems[0]
    extra = audio.manifest_problems(spec, {"ui/tap": {"loop": False}, "ui/star": {}, "ui/x": {}})
    assert any("ui/x" in p for p in extra)
    flag = audio.manifest_problems(spec, {"ui/tap": {"loop": True}, "ui/star": {}})
    assert any("loop flag" in p for p in flag)


def _fake_assets(tmp_path, monkeypatch, ids, manifest_ids):
    """A tmp public/assets/audio with real (decodable, non-silent) mp3s for `ids` and a
    manifest.json listing `manifest_ids`; audio.py pointed at it with a 2-clip spec."""
    import json
    import soundfile as sf

    out = tmp_path / "public" / "assets" / "audio"
    t = np.arange(44100) / 44100
    wav = tmp_path / "tone.wav"
    sf.write(wav, (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32), 44100)
    for cid in ids:
        dst = out / f"{cid}.mp3"
        dst.parent.mkdir(parents=True, exist_ok=True)
        r = audio._run(["-y", "-i", str(wav), "-c:a", "libmp3lame", "-q:a", "3", str(dst)])
        assert r.returncode == 0, r.stderr
    clips = {cid: {"src": f"audio/{cid}.mp3", "seconds": 1.0, "loop": False} for cid in manifest_ids}
    (out / "manifest.json").parent.mkdir(parents=True, exist_ok=True)
    (out / "manifest.json").write_text(json.dumps({"clips": clips}), encoding="utf-8")
    monkeypatch.setattr(audio, "ROOT", tmp_path)
    monkeypatch.setattr(audio, "OUT", out)
    monkeypatch.setattr(audio, "load_spec", lambda: {"clips": [
        {"id": "ui/tap", "loop": False}, {"id": "ui/star", "loop": False}]})


def test_check_passes_when_manifest_is_complete(tmp_path, monkeypatch, capsys):
    _fake_assets(tmp_path, monkeypatch, ["ui/tap", "ui/star"], ["ui/tap", "ui/star"])
    assert audio.check() == 0
    assert "check: OK" in capsys.readouterr().out


def test_check_fails_when_a_yaml_clip_is_missing_from_manifest(tmp_path, monkeypatch, capsys):
    _fake_assets(tmp_path, monkeypatch, ["ui/tap", "ui/star"], ["ui/tap"])
    assert audio.check() == 1
    out = capsys.readouterr().out
    assert "ui/star" in out and "missing from manifest.json" in out and "check: FAILED" in out


def test_committed_manifest_json_covers_every_yaml_clip():
    mpath = HERE.parent.parent / "public" / "assets" / "audio" / "manifest.json"
    if not mpath.exists():
        import pytest
        pytest.skip("audio not generated")
    import json
    clips = json.loads(mpath.read_text(encoding="utf-8"))["clips"]
    assert audio.manifest_problems(MANIFEST, clips) == []


def test_oneshot_is_trimmed_and_faded():
    sr = 8000
    x = np.ones((sr * 3, 2), dtype=np.float32)
    out = audio.shape_oneshot(x, sr, 0.8)
    assert len(out) == int(0.8 * sr)
    assert out[0, 0] == 0 and abs(out[-1, 0]) < 0.05
