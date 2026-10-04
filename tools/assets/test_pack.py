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


def test_band_spans_full_width_and_drops_sky(monkeypatch, tmp_path):
    _patch(monkeypatch, tmp_path)
    _rgba(tmp_path / "t/band.cut.png", (1000, 400), (0, 150, 1000, 400))
    im = pack.pack_band({"id": "t/band", "size": [2000, 640], "cutout": True, "kind": "band"})
    assert im.width == 2000 and 500 + 8 <= im.height <= 500 + 8 + 4   # Lanczos spreads the edge ~2 px
