# tools/assets/test_manifest.py  (uruchamiać: .venv/bin/python -m pytest tools/assets -q)
import re, yaml, pathlib
M = yaml.safe_load((pathlib.Path(__file__).parent / "manifest.yaml").read_text())
FIRE = re.compile(r"\b(fire|flames?|glow(ing)?|burning|sparks?|embers?)\b", re.I)
def test_ids_unique_and_namespaced():
    ids = [a["id"] for a in M["assets"]]; assert len(ids) == len(set(ids)); assert all("/" in i for i in ids)
def test_no_baked_fx_outside_negation():
    for a in M["assets"]:
        for m in FIRE.finditer(a["prompt"]):
            ctx = a["prompt"][max(0, m.start()-12):m.start()].lower()
            assert "no " in ctx or "not " in ctx or "unlit" in ctx, (a["id"], m.group())
def test_sizes_are_multiples_of_16_and_within_flux_limits():
    for a in M["assets"]:
        w, h = a["size"]; assert w % 16 == 0 and h % 16 == 0 and max(w, h) <= 2048, a["id"]
def test_edit_refs_exist():
    ids = {a["id"] for a in M["assets"]}
    for a in M["assets"]:
        if a.get("route") == "edit": assert a["ref"] in ids
