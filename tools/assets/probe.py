import os, re, sys, json, time, pathlib, requests
def fal_key():
    k = os.environ.get("FAL_KEY")
    if k: return k
    for line in pathlib.Path.home().joinpath(".api_keys").read_text().splitlines():
        m = re.match(r"^\s*fal:\s*(\S+)", line)
        if m: return m.group(1)
    sys.exit("no FAL key")
os.environ["FAL_KEY"] = fal_key()
import fal_client
t = time.time()
res = fal_client.subscribe("fal-ai/flux-pro/v1.1", arguments={
  "prompt": "paper-cut layered mountain landscape at dusk, soft gouache texture, storybook indie illustration, muted palette, a single tall peak with a tiny chapel on top, no text",
  "image_size": {"width": 1024, "height": 576}, "num_images": 1, "safety_tolerance": "5", "enable_safety_checker": False})
print(json.dumps({k: v for k, v in res.items() if k != "images"}, indent=1)[:400])
url = res["images"][0]["url"]; print("url:", url, "elapsed", round(time.time()-t,1))
pathlib.Path("raw/probe/flux_probe.png").write_bytes(requests.get(url, timeout=60).content)
print("saved", os.path.getsize("raw/probe/flux_probe.png"))
