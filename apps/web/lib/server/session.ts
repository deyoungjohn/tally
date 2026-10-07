import "server-only";
import { PrivyClient } from "@privy-io/node";

const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 500;

let _defaultPrivyClient: PrivyClient | null = null;
function getDefaultPrivyClient() {
  if (
    !_defaultPrivyClient &&
    process.env.NEXT_PUBLIC_PRIVY_APP_ID &&
    process.env.PRIVY_APP_SECRET
  ) {
    _defaultPrivyClient = new PrivyClient({
      appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
      appSecret: process.env.PRIVY_APP_SECRET,
    });
  }
  return _defaultPrivyClient;
}

const userWalletsCache = new Map<string, { wallets: string[]; expiresAt: number }>();

export function clearSessionCache() {
  userWalletsCache.clear();
}

export interface MinimalPrivyClient {
  utils: () => {
    auth: () => {
      verifyAccessToken: (token: string) => Promise<{ app_id: string; user_id: string }>;
    };
  };
  users: () => {
    _get: (userId: string) => Promise<{ linked_accounts?: Array<{ address?: string } | unknown> }>;
  };
}

export function createSessionVerifier(options?: {
  client?: MinimalPrivyClient;
  appId?: string;
  now?: () => number;
}) {
  const now = options?.now ?? Date.now;

  return async function verifiedWallet(
    req: Request,
    chosen?: string | null,
  ): Promise<string | null> {
    if (process.env.NODE_ENV !== "production" && process.env.TALLY_FIXTURES === "1") {
      const testWallet = process.env.TALLY_TEST_SESSION_WALLET;
      if (testWallet) {
        const normTest = testWallet.toLowerCase();
        if (!chosen || chosen.toLowerCase() === normTest) {
          return normTest;
        }
        return null;
      }
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      return null;
    }
    const token = authHeader.slice(7).trim();
    if (!token) return null;

    const client = options?.client ?? getDefaultPrivyClient();
    if (!client) {
      console.warn("session: no_client");
      return null;
    }

    const expectedAppId = options?.appId ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    if (!expectedAppId) {
      console.warn("session: no_appid");
      return null;
    }

    try {
      let timer: NodeJS.Timeout | undefined;
      const verifyPromise = (async () => {
        const claims = await client.utils().auth().verifyAccessToken(token);
        if (claims.app_id !== expectedAppId) {
          console.warn("session: wrong_appid");
          return null;
        }
        const userId = claims.user_id;
        if (!userId) return null;

        const nowMs = now();
        let wallets: string[] = [];

        const cached = userWalletsCache.get(userId);
        if (cached && cached.expiresAt > nowMs) {
          wallets = cached.wallets;
        } else {
          // Pin: In @privy-io/node 0.35.0, user retrieval by user_id is client.users()._get(user_id)
          const user = await client.users()._get(userId);

          const found = new Set<string>();
          for (const acc of user.linked_accounts || []) {
            if (
              acc &&
              typeof acc === "object" &&
              "address" in acc &&
              typeof acc.address === "string"
            ) {
              const addr = acc.address.toLowerCase();
              if (/^0x[a-fA-F0-9]{40}$/.test(addr)) {
                found.add(addr);
              }
            }
          }
          wallets = Array.from(found);

          if (userWalletsCache.size >= MAX_CACHE_ENTRIES) {
            for (const [k, v] of userWalletsCache.entries()) {
              if (v.expiresAt <= nowMs) {
                userWalletsCache.delete(k);
              }
            }
            if (userWalletsCache.size >= MAX_CACHE_ENTRIES) {
              const firstKey = userWalletsCache.keys().next().value;
              if (firstKey) userWalletsCache.delete(firstKey);
            }
          }
          userWalletsCache.set(userId, { wallets, expiresAt: nowMs + CACHE_TTL_MS });
        }

        if (chosen) {
          const normChosen = chosen.toLowerCase();
          if (/^0x[a-fA-F0-9]{40}$/.test(normChosen) && wallets.includes(normChosen)) {
            return normChosen;
          }
          return null;
        }
        if (wallets.length === 1) {
          return wallets[0] ?? null;
        }
        return null;
      })();

      const timeoutPromise = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          console.warn("session: timeout");
          resolve(null);
        }, 5000);
        timer.unref?.();
      });

      const result = await Promise.race([verifyPromise, timeoutPromise]);
      if (timer) clearTimeout(timer);
      return result;
    } catch {
      console.warn("session: error");
      return null;
    }
  };
}

const defaultVerifier = createSessionVerifier();
export function verifiedWallet(req: Request, chosen?: string | null) {
  return defaultVerifier(req, chosen);
}

// Rate limiting for session endpoints (link-code, active-wallet)
const userHits = new Map<string, number[]>();
export function rateLimitedUser(
  userKey: string,
  bucket: string,
  max: number,
  windowMs = 3_600_000,
) {
  const key = `${bucket}:${userKey.toLowerCase()}`;
  const now = Date.now();
  const recent = (userHits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  userHits.set(key, recent);
  if (userHits.size > 5000) {
    for (const [k, v] of userHits.entries()) {
      if (!v.some((t) => now - t < windowMs)) userHits.delete(k);
    }
  }
  return recent.length > max;
}

export function clearUserRateLimits() {
  userHits.clear();
}
