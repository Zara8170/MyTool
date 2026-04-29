import { cookies } from "next/headers";

const TOKEN_COOKIE = "mytool_token";

/**
 * Web 세션 기본 만료: 7일.
 *
 * CLI 토큰은 1년이지만 웹은 짧게 둠 — 브라우저에 쿠키가 남는 시간이 짧을수록
 * 분실/탈취 시 위험이 줄어듭니다. (서버 측 JWT exp도 7일에 맞춰 발급됩니다.)
 */
const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7일

/**
 * 서버 컴포넌트나 라우트 핸들러에서 현재 사용자 토큰 조회.
 */
export async function getAuthToken(): Promise<string | null> {
  const c = await cookies();
  return c.get(TOKEN_COOKIE)?.value ?? null;
}

/**
 * 라우트 핸들러에서 로그인 후 호출.
 * httpOnly + Secure(prod) + SameSite=Lax 쿠키에 JWT 저장.
 *
 * @param token 발급받은 JWT
 * @param maxAgeSeconds 쿠키 만료 (기본 7일). API 응답의 expiresAt에 맞추기 위해 override 가능.
 */
export async function setAuthToken(
  token: string,
  maxAgeSeconds?: number,
): Promise<void> {
  const c = await cookies();
  c.set(TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function clearAuthToken(): Promise<void> {
  const c = await cookies();
  c.delete(TOKEN_COOKIE);
}
