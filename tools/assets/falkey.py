>>>>>>> worktree-agent-a61a0baf54f882d16
import os, re, pathlib
def fal_key() -> str:
    if os.environ.get("FAL_KEY"): return os.environ["FAL_KEY"]
    for line in (pathlib.Path.home() / ".api_keys").read_text().splitlines():
        m = re.match(r"^\s*fal:\s*(\S+)", line)
        if m: return m.group(1)
    raise SystemExit("FAL_KEY not set and no 'fal:' line in ~/.api_keys")
