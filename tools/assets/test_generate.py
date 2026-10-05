# Offline checks for prompt assembly and request sizes in generate.py.
import generate as g

M = g.load_manifest()
BY_ID = {a["id"]: a for a in M["assets"]}


def test_flux_request_sizes_are_honoured_by_fal_and_keep_the_aspect():
    for a in M["assets"]:
        w, h = g.gen_size(*a["size"])
        assert w <= 1440 and h <= 1440 and w % 32 == 0 and h % 32 == 0, a["id"]
        tw, th = g.target_size(a)
        if a["id"] != "glass/pipe":  # 6:1 hits the 256 px minimum height, pack trims it anyway
            assert abs((w / h) / (tw / th) - 1) < 0.04, a["id"]


def test_subject_comes_before_framing_and_style():
    p = g.full_prompt(BY_ID["turnips/turnip"], M)
    assert p.startswith(BY_ID["turnips/turnip"]["prompt"])
    assert p.index(M["cutout_suffix"].strip()) < p.index(M["style_object"]["dusk"])
    assert "scene" not in p


def test_scene_and_band_use_the_scene_style_and_edit_gets_no_style():
    assert g.full_prompt(BY_ID["glass/bg"], M).endswith(M["style"]["dusk"])
    ridge = BY_ID["hub/ridge_far"]
    band = g.full_prompt(ridge, M)
    assert M["band_suffix"].strip() in band and band.endswith(M["style"][ridge["style"]])
    edit = g.full_prompt(BY_ID["turnips/emma_2"], M)
    assert edit.endswith(M["edit_suffix"]) and "paper-cut" not in edit


def test_nano_ratio_picks_nearest_supported():
    assert g.nano_ratio(1920, 1080) == "16:9"
    assert g.nano_ratio(2048, 448) == "21:9"
    assert g.nano_ratio(512, 640) == "4:5"


def test_wisp_gets_the_black_background_and_the_object_style():
    a = BY_ID["hub/mist_1"]
    p = g.full_prompt(a, M)
    assert p.startswith(a["prompt"]) and M["wisp_suffix"].strip() in p
    assert p.endswith(M["style_object"][a["style"]]) and "paper-cut" not in p


def test_every_style_key_exists_for_its_framing():
    for a in M["assets"]:
        if a.get("route") == "edit":
            continue
        table = M["style_object"] if g.kind(a) in ("object", "wisp") else M["style"]
        assert a["style"] in table, a["id"]


def test_ultra_band_gets_the_land_fraction_hint():
    a = {**BY_ID["hub/ridge_far"], "route": "ultra"}
    assert "bottom 75 percent" in g.full_prompt(a, M)


def _choose_env(monkeypatch, tmp_path):
    """Lock and raw/ in tmp_path; download_png writes a 4x4 image whose red channel encodes the url."""
    from PIL import Image
    monkeypatch.setattr(g, "RAW", tmp_path)
    monkeypatch.setattr(g, "LOCK", tmp_path / "manifest.lock.json")
    monkeypatch.setattr(g, "raw_path", lambda i, suffix=".png": tmp_path / f"{i}{suffix}")
    urls = {"u1": 10, "u2": 20, "r1": 111, "r2": 122}
    downloaded = []

    def fake_download(url, dest):
        downloaded.append(url)
        Image.new("RGB", (4, 4), (urls[url], 0, 0)).save(dest)
        return (4, 4)
    monkeypatch.setattr(g, "download_png", fake_download)
    (tmp_path / "t").mkdir()
    return downloaded


def _red(path):
    from PIL import Image
    return Image.open(path).getpixel((0, 0))[0]


def test_choose_restores_an_earlier_attempt_from_its_copy(monkeypatch, tmp_path):
    from PIL import Image
    downloaded = _choose_env(monkeypatch, tmp_path)
    Image.new("RGB", (4, 4), (10, 0, 0)).save(tmp_path / "t/a.a1.png")   # copy of u1
    Image.new("RGB", (4, 4), (20, 0, 0)).save(tmp_path / "t/a.png")
    (tmp_path / "t/a.cut.png").write_bytes(b"stale")
    a1 = {"model": "m1", "url": "u1", "prompt": "p1"}
    a2 = {"model": "m2", "url": "u2", "prompt": "p2", "note": "re-roll"}
    g.update_lock("t/a", lambda e: e.update({**a2, "attempts": [a1, a2], "cutout": {"x": 1}}))
    g.choose("t/a", 1, "attempt 1 reads better")
    e = g.read_lock()["t/a"]
    assert e["model"] == "m1" and e["url"] == "u1" and e["chosen"] == 1
    assert e["chosen_note"] == "attempt 1 reads better" and "repairs" not in e
    assert "cutout" not in e and len(e["attempts"]) == 2
    assert _red(tmp_path / "t/a.png") == 10 and downloaded == []      # the raw is u1's image
    assert not (tmp_path / "t/a.cut.png").exists()


def test_choose_restores_a_repaired_attempt_from_the_repair_url(monkeypatch, tmp_path):
    from PIL import Image
    downloaded = _choose_env(monkeypatch, tmp_path)
    Image.new("RGB", (4, 4), (10, 0, 0)).save(tmp_path / "t/a.a1.png")   # taken before the repair
    a1 = {"model": "m1", "url": "u1", "prompt": "p1",
          "repairs": [{"url": "r2", "shift_down": 50}, {"url": "r1", "shift_down": 5}]}
    a2 = {"model": "m2", "url": "u2", "prompt": "p2"}
    g.update_lock("t/a", lambda e: e.update({**a2, "attempts": [a1, a2]}))
    g.choose("t/a", 1)
    e = g.read_lock()["t/a"]
    assert downloaded == ["r1"] and _red(tmp_path / "t/a.png") == 111
    assert e["repairs"][-1]["url"] == "r1"                              # lock and raw agree


def test_choose_keeps_top_level_repairs_on_the_attempt_they_fixed(monkeypatch, tmp_path):
    from PIL import Image
    downloaded = _choose_env(monkeypatch, tmp_path)
    Image.new("RGB", (4, 4), (10, 0, 0)).save(tmp_path / "t/a.a1.png")
    Image.new("RGB", (4, 4), (20, 0, 0)).save(tmp_path / "t/a.a2.png")
    a1 = {"model": "m1", "url": "u1", "prompt": "p1"}
    a2 = {"model": "m2", "url": "u2", "prompt": "p2"}
    # attempt 2 is chosen and was repaired afterwards: repair.py records on the top only
    g.update_lock("t/a", lambda e: e.update({**a2, "attempts": [a1, a2], "repairs": [{"url": "r2"}]}))
    g.choose("t/a", 1)
    e = g.read_lock()["t/a"]
    assert "repairs" not in e and e["attempts"][1]["repairs"] == [{"url": "r2"}]
    assert _red(tmp_path / "t/a.png") == 10
    g.choose("t/a", 2)                                                  # back: the repaired image
    e = g.read_lock()["t/a"]
    assert downloaded == ["r2"] and _red(tmp_path / "t/a.png") == 122 and e["repairs"] == [{"url": "r2"}]


def test_choose_rejects_an_unknown_id_a_bad_spec_and_a_missing_attempt(monkeypatch, tmp_path):
    import pytest
    _choose_env(monkeypatch, tmp_path)
    g.update_lock("t/a", lambda e: e.update({"model": "m1", "url": "u1", "attempts": [{"model": "m1", "url": "u1"}]}))
    for argv, msg in ((["--choose", "t/nope=1"], "no entry"), (["--choose", "t/a=x"], "expects ID=N"),
                      (["--choose", "t/a"], "expects ID=N"), (["--choose", "t/a=3"], "attempts 1..1")):
        with pytest.raises(SystemExit) as ex:
            g.main(argv)
        assert msg in str(ex.value), argv
