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
  /** PR 3 — 토큰이 묶인 device. 기존 토큰은 null. */
  tokenDeviceId: string | null;
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
    select: { revokedAt: true, expiresAt: true, deviceId: true },
  });
  if (dbToken?.revokedAt) throw unauthorized("Token has been revoked");
  if (dbToken && dbToken.expiresAt < new Date()) throw unauthorized("Token has expired");

  void touchLastUsedAt(tokenHash);

  return {
    userId: payload.sub,
    userEmail: payload.email,
    tokenHash,
    tokenDeviceId: dbToken?.deviceId ?? null,
  };
}

/**
 * PR 3 — Bearer (cli) 또는 쿠키 (web) 둘 중 하나로 인증.
 *
 * /api/sync/* 라우트는 cli 와 web 양쪽이 모두 사용한다:
 * - cli: Authorization: Bearer <jwt> (1년 짜리 cli 토큰, deviceId 묶임)
 * - web: mytool_token httpOnly 쿠키 (7일 web 세션)
 *
 * 어느 쪽이 와도 user 식별은 동일. tokenDeviceId 는 cli 만 채워진다.
 */
export async function requireAuthAny(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return requireAuth(req);
  }
  // 쿠키 기반 (web). 동적 import 로 cookies() 의존성 회피 가능하지만 server-only 이므로 직접 사용.
  const { cookies } = await import("next/headers");
  const c = await cookies();
  const cookieToken = c.get("mytool_token")?.value;
  if (!cookieToken) throw unauthorized("Not authenticated");

  let payload;
  try {
    payload = await verifyJwt(cookieToken);
  } catch {
    throw unauthorized("Invalid or expired token");
  }

  const tokenHash = hashToken(cookieToken);
  const dbToken = await prisma.cliToken.findUnique({
    where: { tokenHash },
    select: { revokedAt: true, expiresAt: true, deviceId: true },
  });
  if (dbToken?.revokedAt) throw unauthorized("Token has been revoked");
  if (dbToken && dbToken.expiresAt < new Date()) throw unauthorized("Token has expired");

  void touchLastUsedAt(tokenHash);

  return {
    userId: payload.sub,
    userEmail: payload.email,
    tokenHash,
    tokenDeviceId: dbToken?.deviceId ?? null,
  };
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
