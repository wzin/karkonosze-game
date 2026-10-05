# Synthetic checks for pack.py object/band handling (no network, no raw/ needed).
import pathlib
from PIL import Image
import pack


def _rgba(path: pathlib.Path, size, box):
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    im.paste((200, 50, 50, 255), box)
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path)


def _patch(monkeypatch, tmp_path):
    monkeypatch.setattr(pack, "raw_path", lambda i, suffix=".png": tmp_path / f"{i}{suffix}")


def test_object_is_trimmed_with_margin_and_never_upscaled(monkeypatch, tmp_path):
    _patch(monkeypatch, tmp_path)
    _rgba(tmp_path / "t/a.cut.png", (1000, 1000), (400, 300, 500, 700))   # 100x400 subject
    a = {"id": "t/a", "size": [512, 640], "cutout": True}
    im = pack.pack_objects([a])["t/a"]
    assert im.size == (100 + 16, 400 + 16)                  # raw resolution kept, 8 px margin
    assert im.getpixel((3, 3))[3] == 0 and im.getpixel((58, 208))[3] == 255


def test_large_object_is_fitted_into_target_box(monkeypatch, tmp_path):
    _patch(monkeypatch, tmp_path)
    _rgba(tmp_path / "t/b.cut.png", (2000, 2000), (0, 0, 2000, 1000))
    im = pack.pack_objects([{"id": "t/b", "size": [512, 512], "cutout": True}])["t/b"]
    assert max(im.size) <= 512 and im.size[0] == 512


def test_animation_frames_share_size_and_alignment(monkeypatch, tmp_path):
    _patch(monkeypatch, tmp_path)
    _rgba(tmp_path / "t/f1.cut.png", (600, 900), (100, 100, 300, 800))
    _rgba(tmp_path / "t/f2.cut.png", (400, 600), (100, 60, 250, 540))   # other resolution, same canvas
    f1 = {"id": "t/f1", "size": [640, 960], "cutout": True}
    f2 = {"id": "t/f2", "size": [640, 960], "cutout": True, "route": "edit", "ref": "t/f1"}
    out = pack.pack_objects([f1, f2])
    assert out["t/f1"].size == out["t/f2"].size


def test_pack_merges_into_existing_manifest_when_raw_is_missing(monkeypatch, tmp_path, capsys):
    import json
    _patch(monkeypatch, tmp_path / "raw")
    out = tmp_path / "public" / "assets" / "gfx"
    monkeypatch.setattr(pack, "OUT", out)
    monkeypatch.setattr(pack, "MANIFEST_JSON", out / "manifest.json")
    assets = [{"id": "t/new", "size": [64, 32]}, {"id": "t/old", "size": [64, 32]}]
    monkeypatch.setattr(pack, "load_manifest", lambda: {"assets": assets})
    # committed state: t/old packed earlier, plus an entry for an id that left manifest.yaml
    (out / "t").mkdir(parents=True)
    Image.new("RGB", (40, 20), (1, 2, 3)).save(out / "t/old.webp")
    old = {"src": "gfx/t/old.webp", "w": 40, "h": 20}
    (out / "manifest.json").write_text(json.dumps({"assets": {"t/old": old, "t/gone": old}}))
    # raw/ has only t/new
    (tmp_path / "raw/t").mkdir(parents=True)
    Image.new("RGB", (128, 64), (200, 100, 50)).save(tmp_path / "raw/t/new.png")

    assert pack.pack() == 0
    m = json.loads((out / "manifest.json").read_text())["assets"]
    assert m["t/old"] == old                                    # preserved, not dropped
    assert m["t/new"] == {"src": "gfx/t/new.webp", "w": 64, "h": 32}
    assert "t/gone" not in m
    assert "repacked 1, kept 1" in capsys.readouterr().out
    assert pack.check() == 0


def test_band_spans_full_width_and_drops_sky(monkeypatch, tmp_path):
    _patch(monkeypatch, tmp_path)
    _rgba(tmp_path / "t/band.cut.png", (1000, 400), (0, 150, 1000, 400))
    im = pack.pack_band({"id": "t/band", "size": [2000, 640], "cutout": True, "kind": "band"})
    assert im.width == 2000 and 500 + 8 <= im.height <= 500 + 8 + 4   # Lanczos spreads the edge ~2 px


def test_fade_x_fades_both_ends_and_keeps_the_middle():
    im = Image.new("RGBA", (400, 20), (230, 230, 240, 200))
    out = pack.fade_x(im, 0.25)
    a = [out.getpixel((x, 10))[3] for x in (0, 50, 100, 200, 300, 349, 399)]
    assert a[0] <= 2 and a[-1] <= 2                      # ends fully faded
    assert 0 < a[1] < a[2] and a[2] == 200 and a[3] == 200 and a[4] == 200   # ramp, then untouched
    assert abs(a[1] - a[5]) <= 2                          # symmetric
    assert out.getpixel((200, 10))[:3] == (230, 230, 240)


def test_fade_x_is_applied_per_asset_option(monkeypatch, tmp_path):
    import json
    _patch(monkeypatch, tmp_path / "raw")
    out = tmp_path / "public" / "assets" / "gfx"
    monkeypatch.setattr(pack, "OUT", out)
    monkeypatch.setattr(pack, "MANIFEST_JSON", out / "manifest.json")
    assets = [{"id": "t/mist", "size": [400, 100], "cutout": True, "kind": "wisp", "fade_x": True},
              {"id": "t/rock", "size": [400, 100], "cutout": True}]
    monkeypatch.setattr(pack, "load_manifest", lambda: {"assets": assets})
    for i in ("mist", "rock"):
        _rgba(tmp_path / f"raw/t/{i}.cut.png", (400, 100), (0, 0, 400, 100))
    assert pack.pack() == 0
    mist = Image.open(out / "t/mist.webp").convert("RGBA")
    rock = Image.open(out / "t/rock.webp").convert("RGBA")
    assert mist.getpixel((9, 50))[3] < 20 and mist.getpixel((mist.width // 2, 50))[3] > 240
    assert rock.getpixel((9, 50))[3] > 240
    assert pack.fade_fraction({"fade_x": 0.4}) == 0.4 and pack.fade_fraction({}) is None


def test_paper_margin_is_found_only_when_light_and_on_all_four_sides():
    import numpy as np
    sheet = np.zeros((200, 300, 3), np.uint8); sheet[:] = (238, 236, 230)
    sheet[12:190, 15:285] = (60, 70, 90)                      # the painting
    assert pack.paper_margin(sheet) == tuple(v + pack.PAPER_INSET for v in (15, 12, 15, 10))
    sky = np.zeros((200, 300, 3), np.uint8); sky[:] = (40, 40, 80)
    sky[100:] = (20, 30, 20)                                  # dark flat sky on top: not a margin
    assert pack.paper_margin(sky) is None


def test_band_margin_crops_keyed_sides_and_bottom_but_not_a_full_width_band():
    import numpy as np
    a = np.zeros((100, 200), np.uint8)
    a[40:90, 10:190] = 255                                    # land inside a keyed-out sheet margin
    x0, x1, y1 = pack.band_margin(a)
    assert 10 <= x0 <= 12 and 188 <= x1 <= 190 and 88 <= y1 <= 90
    full = np.zeros((100, 200), np.uint8); full[40:] = 255
    assert pack.band_margin(full) == (0, 200, 100)
