import { z } from "zod";

/**
 * 토큰 종류 — Web 세션은 7일, CLI 토큰은 1년 유효.
 * 클라이언트가 로그인/회원가입 시 자기 종류를 명시.
 */
export const TokenKindSchema = z.enum(["web", "cli"]);
export type TokenKind = z.infer<typeof TokenKindSchema>;

export const RegisterRequestSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100).optional(),
  /** 클라이언트 종류. 미지정 시 web으로 간주. */
  kind: TokenKindSchema.optional(),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1).max(128),
  /** 클라이언트 종류. 미지정 시 web으로 간주. */
  kind: TokenKindSchema.optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const AuthUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const AuthResponseSchema = z.object({
  token: z.string(),
  user: AuthUserSchema,
  /** 발급된 토큰의 종류 (web/cli) */
  kind: TokenKindSchema,
  /** 발급된 토큰의 만료 시각 (ISO 8601) */
  expiresAt: z.string().datetime(),
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const MeResponseSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  organizations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      role: z.enum(["OWNER", "MEMBER"]),
    }),
  ),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/**
 * 세션 관리: 사용자가 자신의 활성/만료 토큰 목록을 볼 때 사용.
 * 평문 토큰은 절대 포함하지 않음.
 */
export const SessionItemSchema = z.object({
  id: z.string(),
  kind: TokenKindSchema,
  label: z.string().nullable(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  isCurrent: z.boolean(),
  isExpired: z.boolean(),
  isActive: z.boolean(),
});
export type SessionItem = z.infer<typeof SessionItemSchema>;

export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionItemSchema),
});
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;
