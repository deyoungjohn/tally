# WO-11 Evidence, fixtures and docs support (low risk)

| | |
|---|---|
| Agent | F (Cline · Muse Spark, free tier) |
| Branch | `mod/WO-11-support` |
| Rule | No code under `packages/`, `apps/` or `contracts/`. Docs, fixtures index and read-only recorders only. |

## Owns

- `docs/evidence/**` (new), `docs/demo/**` (new)
- `spike/record_*.py` **new** files only (read-only recorders), never existing ones
- `README.md` (from Thu 8 only, after the orchestrator says which modules shipped)

## Tasks

1. `docs/evidence/INDEX.md`: a table of every recorded file in `packages/binance/fixtures/raw/` and `spike/results/` with date, what it recorded, and which work orders use it. Facts only, copied from file contents, no interpretation.
2. `docs/evidence/api-observations.md`: for each item in `MODULES.md` §6, the exact request (path + params, no keys) and the exact response snippet from the probe file. This is raw evidence for the user's report; do not write report prose or opinions.
3. `docs/demo/script.md` (from Thu 8): a 4-minute demo script outline per shipped module, with the exact screens and commands.
4. On request from the orchestrator: new read-only recorder scripts in `spike/` following `spike/record_module_probes.py`.

## Exit checks

- [ ] Every row in `INDEX.md` points to a file that exists; every snippet in `api-observations.md` matches the file byte-for-byte (orchestrator spot-checks 5).
- [ ] No file outside owned paths changed.
