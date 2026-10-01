"""Pattern analysis over the 87 winning projects in projects.jsonl.

    python3 research/analyze_winners.py
"""
import collections
import json
import os
import re

ROOT = os.path.join(os.path.dirname(__file__), "..")
P = [json.loads(line) for line in open(os.path.join(ROOT, "projects.jsonl"))]
FIRST = re.compile(r"1st|grand|rank 1\b|winner —", re.I)

THEMES = {
    "verifiable evidence (audit/proof/receipt/attest)": r"audit|proof|receipt|attest|evidence|verif",
    "AI bounded by policy (limits/gates/kill switch)": r"polic|bound|limit|kill switch|gate|firewall|guard|constrain",
    "x402 / paid machine calls": r"x402|pay-per|micropay|paid",
    "credit / lending": r"credit|lend|borrow",
    "risk monitoring / protective action": r"liquidat|position health|risk",
    "privacy / confidential": r"confidential|encrypt|private|privacy|zk",
    "agent marketplace / escrow": r"escrow|marketplace",
    "RWA / tokenized assets": r"rwa|real-world|invoice|receivable|tokenized",
    "trading / portfolio agent": r"portfolio|rebalanc|trading|vault",
    "onboarding UX": r"onboard|non-programmer|low-code|familiar|hid",
}


def text(p):
    return " ".join([p["problem"], p["solution"], p["differentiators"]]).lower()


def main():
    n = len(P)
    print(f"winning projects: {n}")
    for k in ["ai_role", "web3_role", "sponsor_technology_use", "commits_before_hackathon_start"]:
        print(f"  {k}: {dict(collections.Counter(str(p.get(k)) for p in P))}")
    print("\ntheme                                              share   first-place examples")
    for name, rx in THEMES.items():
        hit = [p for p in P if re.search(rx, text(p))]
        firsts = [p["project"] for p in hit if FIRST.search(p["placement"])]
        print(f"  {name:48s} {len(hit):2d} ({len(hit) / n:4.0%})  {', '.join(firsts) or '-'}")


if __name__ == "__main__":
    main()
