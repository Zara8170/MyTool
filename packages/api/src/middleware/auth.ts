import { createMiddleware } from "hono/factory";
import { prisma } from "../db.js";
import { hashToken, verifyJwt } from "../lib/jwt.js";
import { unauthorized } from "../lib/errors.js";

export interface AuthVariables {
  userId: string;
  userEmail: string;
  /** 현재 요청의 토큰 해시 — 세션 관리 라우트에서 isCurrent 판별용 */
  tokenHash: string;
}

declare module "hono" {
  interface ContextVariableMap extends AuthVariables {}
}

/**
 * lastUsedAt 갱신은 60초 간격으로 throttle.
 * 모든 요청마다 DB write가 발생하지 않도록 메모리 캐시.
 */
const LAST_USED_THROTTLE_MS = 60_000;
const lastUsedCache = new Map<string, number>();
const MAX_CACHE_ENTRIES = 10_000;

/**
 * Authorization: Bearer <jwt> 헤더를 검증합니다.
 * - JWT 서명 검증
 * - DB에서 토큰 revocation/expiry 체크
 * - 통과 시 c.set('userId', ...), c.set('userEmail', ...), c.set('tokenHash', ...)
 * - lastUsedAt를 throttle로 갱신 (응답 후 fire-and-forget)
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
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

  // Revocation 체크
  const tokenHash = hashToken(token);
  const dbToken = await prisma.cliToken.findUnique({
    where: { tokenHash },
    select: { revokedAt: true, expiresAt: true },
  });
  if (dbToken?.revokedAt) {
    throw unauthorized("Token has been revoked");
  }
  if (dbToken && dbToken.expiresAt < new Date()) {
    throw unauthorized("Token has expired");
  }

  c.set("userId", payload.sub);
  c.set("userEmail", payload.email);
  c.set("tokenHash", tokenHash);

  await next();

  // 응답 처리 후 lastUsedAt 갱신 (throttled, fire-and-forget)
  void touchLastUsedAt(tokenHash);
});

async function touchLastUsedAt(tokenHash: string): Promise<void> {
  const now = Date.now();
  const last = lastUsedCache.get(tokenHash);
  if (last && now - last < LAST_USED_THROTTLE_MS) return;

  lastUsedCache.set(tokenHash, now);

  // 메모리 누수 방지
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
    // 무시 — lastUsedAt 갱신 실패가 요청 처리를 방해하면 안 됨
  }
}
