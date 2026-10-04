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
    band = g.full_prompt(BY_ID["hub/ridge_far"], M)
    assert M["band_suffix"].strip() in band and band.endswith(M["style"]["dusk"])
    edit = g.full_prompt(BY_ID["turnips/emma_2"], M)
    assert edit.endswith(M["edit_suffix"]) and "paper-cut" not in edit


def test_nano_ratio_picks_nearest_supported():
    assert g.nano_ratio(1920, 1080) == "16:9"
    assert g.nano_ratio(2048, 448) == "21:9"
    assert g.nano_ratio(512, 640) == "4:5"
