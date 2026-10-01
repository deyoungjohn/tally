# Tally: instructions for AI sessions

- **Start by reading** `TALLY_BLUEPRINT.md` (end to end), then `DESIGN.md`, then `IDEAS.md` §Findings F1–F9. The decisions in blueprint §4 are final unless new evidence contradicts them; propose changes, don't make them silently.
- **Build in milestone order** (blueprint §17). Before coding a milestone, list its tasks and exit checks. A milestone is done only when every exit check passes.
- **Never create, request, print or store private keys or seed phrases.** The user creates the ShareGuard deployer/owner key and the Ondo feed-signer key and runs deployments on their own machine (blueprint §19). Secrets live only in the server's env file, never in git.
- **Never deploy spike code.** `spike/shareguard/src/ShareGuard.sol` has a known arbitrary-call hole; ShareGuard v1 must allow-list routers (blueprint §10, fork test G).
- **UI:** follow `DESIGN.md` exactly. Use beUI components via the BeUI MCP and restyle them with our tokens. Every screen is checked at 375/768/1280px and with reduced motion before it counts as done.
- **Binance Web3 API:** errors can arrive as HTTP 200, so always check the JSON `code`. Never trust the API's `gas` (always 450000); estimate and simulate at the exact limit you send. The minimum order is 6 USDT.
- **Don't rename** the old `parity` identifiers inside `spike/` and `research/` (historical; the fork test's fixed address is derived from `"parity.shareguard.fork"`).
- **Git:** one branch and one PR per milestone. Keep `main` deployable.
- **The Developer Experience Report is written by the user**, not by an AI (the hackathon rejects AI-generated reports). You may point to evidence in `IDEAS.md`.
