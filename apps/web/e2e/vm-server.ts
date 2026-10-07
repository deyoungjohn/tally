import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * A second standalone server for the view-model e2e: module flags on, its own throw-away data dir, seeded with recorded
 * snapshots. The default e2e server runs with every module flag off, which is exactly what the flag-off tests need.
 */
export interface VmServer {
  url: string;
  dir: string;
  stop(): void;
}

const WEB = resolve(__dirname, "..");

export async function startVmServer(opts: {
  port: number;
  /** "full" seeds statement snapshots and receipts; "none" leaves the store empty and every module never-updated. */
  seed: "full" | "radar" | "none";
  flags?: Record<string, string>;
}): Promise<VmServer> {
  const dir = mkdtempSync(join(tmpdir(), "tally-vm-e2e-"));
  const env = {
    ...process.env,
    TALLY_DATA_DIR: dir,
    TALLY_FIXTURES: "1",
    TALLY_ALLOW_MISSING_GEO: "1",
    TALLY_RATE_LIMIT_MULT: "50",
    PORT: String(opts.port),
    HOSTNAME: "127.0.0.1",
    ...(opts.flags ?? {}),
  };
  if (opts.seed === "full") {
    const run = (file: string, extra: Record<string, string> = {}) => {
      const r = spawnSync("pnpm", ["--filter", "@tally/worker", "exec", "tsx", file], {
        env: { ...env, ...extra },
        encoding: "utf8",
      });
      if (r.status !== 0) throw new Error(`seed failed (${file}): ${r.stderr.slice(0, 300)}`);
    };
    run(join(WEB, "modules/receipts/seed.ts"), { TALLY_RECEIPT_PREVIEW: "1" });
    run(join(WEB, "e2e/vm-seed.ts"), {});
  }
  if (opts.seed === "radar") {
    const r = spawnSync(
      "pnpm",
      ["--filter", "@tally/worker", "exec", "tsx", join(WEB, "e2e/radar-seed.ts")],
      {
        env,
        encoding: "utf8",
      },
    );
    if (r.status !== 0) throw new Error(`seed failed (radar-seed): ${r.stderr.slice(0, 300)}`);
  }
  const child: ChildProcess = spawn("node", [".next/standalone/apps/web/server.js"], {
    cwd: WEB,
    env,
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${opts.port}`;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${url}/api/health`, { headers: { "cf-ipcountry": "KR" } });
      if (r.status < 500) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return {
    url,
    dir,
    stop() {
      child.kill("SIGTERM");
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}
