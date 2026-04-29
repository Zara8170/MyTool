import "server-only";
import { prisma } from "./db";
import { hashToken, verifyJwt } from "./jwt";
import { unauthorized } from "./api-errors";

const LAST_USED_THROTTLE_MS = 60_000;
const lastUsedCache = new Map<string, number>();
const MAX_CACHE_ENTRIES = 10_000;

export interface AuthContext {
  userId: string;
  userEmail: string;
  tokenHash: string;
}

export async function requireAuth(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw unauthorized("Missing Bearer token");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) throw unauthorized("Empty token");

  let payload;
  try {
    payload = await verifyJwt(token);
  } catch {
    throw unauthorized("Invalid or expired token");
  }

  const tokenHash = hashToken(token);
  const dbToken = await prisma.cliToken.findUnique({
    where: { tokenHash },
    select: { revokedAt: true, expiresAt: true },
  });
  if (dbToken?.revokedAt) throw unauthorized("Token has been revoked");
  if (dbToken && dbToken.expiresAt < new Date()) throw unauthorized("Token has expired");

  void touchLastUsedAt(tokenHash);

  return { userId: payload.sub, userEmail: payload.email, tokenHash };
}

async function touchLastUsedAt(tokenHash: string): Promise<void> {
  const now = Date.now();
  const last = lastUsedCache.get(tokenHash);
  if (last && now - last < LAST_USED_THROTTLE_MS) return;

  lastUsedCache.set(tokenHash, now);
  if (lastUsedCache.size > MAX_CACHE_ENTRIES) {
    const cutoff = now - LAST_USED_THROTTLE_MS * 2;
    for (const [k, v] of lastUsedCache) {
      if (v < cutoff) lastUsedCache.delete(k);
    }
  }

  try {
    await prisma.cliToken.update({
      where: { tokenHash },
      data: { lastUsedAt: new Date(now) },
    });
  } catch {
    // lastUsedAt 갱신 실패는 무시
  }
}
