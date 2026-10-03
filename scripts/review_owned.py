"""Owned-path check for a work-order branch. Usage: python scripts/review_owned.py <branch> <files.txt>

Reads the "## Owns" section of docs/work-orders/WO-<nn>-*.md (backticked paths/globs in bullet lines) and
prints every changed file that is not covered. Exit code 1 if any file is outside the owned paths.
"""
import fnmatch
import glob
import re
import sys

branch, files_path = sys.argv[1], sys.argv[2]
m = re.search(r"WO-(\d{2})", branch)
if not m:
    print(f"cannot find WO-<nn> in branch name {branch!r}")
    sys.exit(2)
matches = glob.glob(f"docs/work-orders/WO-{m.group(1)}-*.md")
if not matches:
    print(f"no work order file for WO-{m.group(1)}")
    sys.exit(2)
text = open(matches[0], encoding="utf-8").read()
section = text.split("## Owns", 1)[1].split("\n## ", 1)[0]
patterns = []
for line in section.splitlines():
    if line.strip().startswith("-"):
        patterns += re.findall(r"`([^`]+)`", line)
patterns = [p.rstrip("/") for p in patterns]


def _glob(p):
    # literal [ ] (e.g. [txHash]) and ** for any depth; fnmatch's * already crosses "/"
    return p.replace("[", "[[]").replace("**", "*")


def covered(path):
    for p in patterns:
        if p.endswith("/**"):
            if fnmatch.fnmatchcase(path, _glob(p[:-3]) + "/*"):
                return True
        elif "*" in p:
            if fnmatch.fnmatchcase(path, _glob(p)):
                return True
        elif path == p or path.startswith(p + "/"):
            return True
    return False


changed = [l.strip() for l in open(files_path, encoding="utf-8") if l.strip()]
outside = [f for f in changed if not covered(f)]
print(f"work order: {matches[0]}")
print("owned patterns:\n  " + "\n  ".join(patterns))
print(f"\nchanged files: {len(changed)}, outside owned paths: {len(outside)}")
for f in outside:
    print(f"  OUTSIDE  {f}")
sys.exit(1 if outside else 0)
