import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "../env.js";

const ISSUER = "mytool";
const AUDIENCE = "mytool-cli-web";

/**
 * 토큰 종류별 유효 기간.
 *   - web: 7일 (브라우저 세션 — 짧게 유지해서 노출 위험 감소)
 *   - cli: 365일 (개발자 머신에 한 번 로그인하면 1년)
 */
export type TokenKind = "web" | "cli";

export const TOKEN_LIFETIMES: Record<TokenKind, { days: number; jwtExp: string }> = {
  web: { days: 7, jwtExp: "7d" },
  cli: { days: 365, jwtExp: "365d" },
};

export interface JwtPayload {
  sub: string; // userId
  email: string;
  /** 토큰의 용도 — 미지정(레거시 토큰)은 web으로 간주 */
  kind?: TokenKind;
}

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().JWT_SECRET);
}

export async function signJwt(payload: {
  sub: string;
  email: string;
  kind: TokenKind;
}): Promise<string> {
  const lifetime = TOKEN_LIFETIMES[payload.kind];
  return await new SignJWT({ email: payload.email, kind: payload.kind })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(lifetime.jwtExp)
    .sign(getSecretKey());
}

export async function verifyJwt(token: string): Promise<Required<JwtPayload>> {
  const { payload } = await jwtVerify(token, getSecretKey(), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (!payload.sub || typeof payload.email !== "string") {
    throw new Error("Invalid JWT payload");
  }
  // kind가 누락된 레거시 토큰은 web으로 간주 (안전한 기본값 — 짧은 만료)
  const kind: TokenKind = payload.kind === "cli" ? "cli" : "web";
  return { sub: payload.sub, email: payload.email as string, kind };
}

/**
 * JWT의 SHA-256 해시. CliToken 테이블에는 평문 토큰 대신 이 해시만 저장.
 * Revocation 체크 시 평문 토큰 → 해시 → DB 조회.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * DB에 저장할 expiresAt — JWT exp와 일치시킴.
 */
export function tokenExpiresAt(kind: TokenKind): Date {
  const date = new Date();
  date.setDate(date.getDate() + TOKEN_LIFETIMES[kind].days);
  return date;
}
