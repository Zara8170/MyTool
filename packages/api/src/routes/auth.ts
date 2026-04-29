import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import bcrypt from "bcrypt";
import {
  AuthResponseSchema,
  LoginRequestSchema,
  MeResponseSchema,
  RegisterRequestSchema,
  SessionListResponseSchema,
  type TokenKind as SharedTokenKind,
} from "@mytool/shared";
import type { TokenKind as PrismaTokenKind } from "@prisma/client";
import { prisma } from "../db.js";
import {
  hashToken,
  signJwt,
  tokenExpiresAt,
  type TokenKind,
} from "../lib/jwt.js";
import { conflict, forbidden, notFound, unauthorized } from "../lib/errors.js";
import { authMiddleware } from "../middleware/auth.js";
import {
  ipKey,
  rateLimit,
  userKey,
} from "../middleware/rate-limit.js";

const BCRYPT_ROUNDS = 12;

export const authRoute = new Hono();

// ──────────────────────────────────────────────────────────────
// Rate limiters
// ──────────────────────────────────────────────────────────────
//
// 로그인/회원가입은 IP 기반 제한 (분당 5회) — 무차별 대입 방어
// /me 는 인증된 사용자별 제한 (분당 60회) — 정상 사용에는 충분
//
const authAttemptLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  bucket: "auth-attempt",
  key: ipKey("auth"),
  message: "Too many attempts. Try again in a minute.",
});

const meLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  bucket: "me",
  key: userKey("me"),
});

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function toPrismaKind(kind: TokenKind): PrismaTokenKind {
  return kind === "cli" ? "CLI" : "WEB";
}

function toSharedKind(kind: PrismaTokenKind): SharedTokenKind {
  return kind === "CLI" ? "cli" : "web";
}

/**
 * User-Agent 헤더로 토큰 라벨 자동 생성.
 * 정확하지 않아도 사용자 식별에 도움이 되는 정도면 OK.
 */
function deriveLabel(ua: string | undefined, kind: TokenKind): string {
  if (kind === "cli") return ua && ua.includes("mytool-cli") ? "mytool CLI" : "CLI";
  if (!ua) return "Web";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  return "Web";
}

async function issueToken(
  userId: string,
  email: string,
  kind: TokenKind,
  userAgent: string | undefined,
): Promise<{ token: string; expiresAt: Date }> {
  const token = await signJwt({ sub: userId, email, kind });
  const expiresAt = tokenExpiresAt(kind);
  await prisma.cliToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      kind: toPrismaKind(kind),
      label: deriveLabel(userAgent, kind),
      expiresAt,
    },
  });
  return { token, expiresAt };
}

// ──────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────

/**
 * POST /api/auth/register
 * 새 사용자 생성. 첫 사용자에게는 자동으로 개인 organization 생성.
 */
authRoute.post(
  "/register",
  authAttemptLimiter,
  zValidator("json", RegisterRequestSchema),
  async (c) => {
    const { email, password, name, kind: rawKind } = c.req.valid("json");
    const kind: TokenKind = rawKind === "cli" ? "cli" : "web";

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw conflict("Email already registered");

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // 사용자 생성과 동시에 개인 org 생성 (혼자 쓸 때도 동작하게)
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: name ?? null,
        memberships: {
          create: {
            role: "OWNER",
            org: {
              create: {
                name: name ?? email.split("@")[0]!,
                slug: generateUniqueSlug(email),
              },
            },
          },
        },
      },
    });

    const ua = c.req.header("user-agent");
    const { token, expiresAt } = await issueToken(user.id, user.email, kind, ua);

    const response = AuthResponseSchema.parse({
      token,
      kind,
      expiresAt: expiresAt.toISOString(),
      user: { id: user.id, email: user.email, name: user.name },
    });
    return c.json(response, 201);
  },
);

/**
 * POST /api/auth/login
 * 이메일·비밀번호로 JWT 발급.
 */
authRoute.post(
  "/login",
  authAttemptLimiter,
  zValidator("json", LoginRequestSchema),
  async (c) => {
    const { email, password, kind: rawKind } = c.req.valid("json");
    const kind: TokenKind = rawKind === "cli" ? "cli" : "web";

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw unauthorized("Invalid email or password");

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw unauthorized("Invalid email or password");

    const ua = c.req.header("user-agent");
    const { token, expiresAt } = await issueToken(user.id, user.email, kind, ua);

    const response = AuthResponseSchema.parse({
      token,
      kind,
      expiresAt: expiresAt.toISOString(),
      user: { id: user.id, email: user.email, name: user.name },
    });
    return c.json(response);
  },
);

/**
 * DELETE /api/auth/session
 * 현재 토큰 revoke (logout).
 */
authRoute.delete("/session", authMiddleware, async (c) => {
  const tokenHash = c.get("tokenHash");
  await prisma.cliToken.update({
    where: { tokenHash },
    data: { revokedAt: new Date() },
  });
  return c.json({ ok: true });
});

/**
 * GET /api/auth/me
 * 현재 사용자 정보 + 소속 조직 목록.
 */
authRoute.get("/me", meLimiter, authMiddleware, async (c) => {
  const userId = c.get("userId");
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        include: { org: true },
      },
    },
  });
  if (!user) throw unauthorized();

  const response = MeResponseSchema.parse({
    id: user.id,
    email: user.email,
    name: user.name,
    organizations: user.memberships.map((m) => ({
      id: m.org.id,
      name: m.org.name,
      slug: m.org.slug,
      role: m.role,
    })),
  });
  return c.json(response);
});

/**
 * GET /api/auth/sessions
 * 현재 사용자의 모든 토큰(세션) 목록.
 * 평문 토큰은 절대 포함하지 않음.
 */
authRoute.get("/sessions", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const currentHash = c.get("tokenHash");
  const now = new Date();

  const tokens = await prisma.cliToken.findMany({
    where: { userId },
    orderBy: [{ revokedAt: "asc" }, { lastUsedAt: "desc" }, { createdAt: "desc" }],
  });

  const sessions = tokens.map((t) => {
    const isExpired = t.expiresAt < now;
    const isRevoked = t.revokedAt !== null;
    return {
      id: t.id,
      kind: toSharedKind(t.kind),
      label: t.label,
      createdAt: t.createdAt.toISOString(),
      expiresAt: t.expiresAt.toISOString(),
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      revokedAt: t.revokedAt?.toISOString() ?? null,
      isCurrent: t.tokenHash === currentHash,
      isExpired,
      isActive: !isRevoked && !isExpired,
    };
  });

  return c.json(SessionListResponseSchema.parse({ sessions }));
});

/**
 * DELETE /api/auth/sessions/:id
 * 특정 토큰 revoke (다른 디바이스 로그아웃).
 * 본인의 토큰만 revoke 가능.
 */
authRoute.delete("/sessions/:id", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const token = await prisma.cliToken.findUnique({ where: { id } });
  if (!token) throw notFound("Session not found");
  if (token.userId !== userId) throw forbidden("Not your session");

  if (token.revokedAt) {
    return c.json({ ok: true, alreadyRevoked: true });
  }

  await prisma.cliToken.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  return c.json({ ok: true });
});

// 개인 org slug 생성 헬퍼 — 충돌 시 숫자 suffix 추가
function generateUniqueSlug(email: string): string {
  const base = email
    .split("@")[0]!
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return `${base || "user"}-${Date.now().toString(36)}`;
}
