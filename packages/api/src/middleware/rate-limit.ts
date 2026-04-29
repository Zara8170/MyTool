import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { rateLimited } from "../lib/errors.js";

/**
 * 메모리 기반 sliding-window rate limiter.
 *
 * 단일 프로세스에서만 동작합니다 — 다중 인스턴스로 확장할 때는
 * Redis로 키-스코어 저장소를 교체해야 합니다.
 *
 * 사용법:
 *   route.use("/login", rateLimit({
 *     windowMs: 60_000,
 *     max: 5,
 *     bucket: "login",
 *     key: ipKey,                     // 또는 userKey
 *     message: "Too many login attempts. Try again in a minute.",
 *   }));
 */

interface RateLimitOpts {
  /** 윈도우 길이 (ms) */
  windowMs: number;
  /** 윈도우 내 허용 횟수 */
  max: number;
  /** 카운터 분리용 prefix (예: "login", "events") — 다른 라우트의 키와 섞이지 않게 */
  bucket: string;
  /** 식별자 키 추출. ipKey / userKey 헬퍼 사용 권장 */
  key: (c: Context) => string;
  /** 한도 초과 시 메시지 */
  message?: string;
}

interface Bucket {
  /** 윈도우 내 발생한 요청들의 epoch ms 타임스탬프 */
  timestamps: number[];
}

// bucket → 식별자 → Bucket
const STORE = new Map<string, Map<string, Bucket>>();
const MAX_KEYS_PER_BUCKET = 10_000;

/**
 * 클라이언트 IP를 추출. X-Forwarded-For가 있으면 첫 번째 항목 사용.
 * 셀프호스팅 환경에서는 reverse proxy 뒤에 있는 게 일반적이므로 헤더를 우선.
 */
export function getClientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = c.req.header("x-real-ip");
  if (real) return real.trim();
  // hono의 raw 환경(node-server)에서는 socket 정보 접근이 제한적이므로 fallback
  return "unknown";
}

export function ipKey(prefix: string) {
  return (c: Context): string => `${prefix}:ip:${getClientIp(c)}`;
}

export function userKey(prefix: string) {
  return (c: Context): string => {
    const userId = c.get("userId" as never) as string | undefined;
    return userId ? `${prefix}:user:${userId}` : `${prefix}:ip:${getClientIp(c)}`;
  };
}

export function rateLimit(opts: RateLimitOpts) {
  return createMiddleware(async (c, next) => {
    let bucketStore = STORE.get(opts.bucket);
    if (!bucketStore) {
      bucketStore = new Map();
      STORE.set(opts.bucket, bucketStore);
    }

    const id = opts.key(c);
    const now = Date.now();
    const cutoff = now - opts.windowMs;

    let bucket = bucketStore.get(id);
    if (!bucket) {
      bucket = { timestamps: [] };
      bucketStore.set(id, bucket);
    }

    // 윈도우 밖 타임스탬프 제거
    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

    if (bucket.timestamps.length >= opts.max) {
      const oldest = bucket.timestamps[0]!;
      const retryAfterMs = Math.max(0, opts.windowMs - (now - oldest));
      c.header("Retry-After", Math.ceil(retryAfterMs / 1000).toString());
      throw rateLimited(opts.message ?? "Too many requests");
    }

    bucket.timestamps.push(now);

    // 메모리 청소: 같은 bucket의 키가 너무 많아지면 만료된 키 제거
    if (bucketStore.size > MAX_KEYS_PER_BUCKET) {
      cleanupBucket(bucketStore, cutoff);
    }

    await next();
  });
}

function cleanupBucket(bucketStore: Map<string, Bucket>, cutoff: number): void {
  for (const [k, v] of bucketStore) {
    const fresh = v.timestamps.filter((t) => t > cutoff);
    if (fresh.length === 0) bucketStore.delete(k);
    else v.timestamps = fresh;
  }
}
