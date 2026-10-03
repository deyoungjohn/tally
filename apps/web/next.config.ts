import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  output: "standalone",
  // Monorepo: trace workspace packages into the standalone bundle.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: [
    "@tally/config",
    "@tally/core",
    "@tally/binance",
    "@tally/chain",
    "@tally/engine",
  ],
  poweredByHeader: false,
  // Next 16 would otherwise write AGENTS.md and CLAUDE.md into apps/web on every dev start.
  agentRules: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
