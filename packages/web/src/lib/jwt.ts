import "server-only";
import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

const ISSUER = "mytool";
const AUDIENCE = "mytool-cli-web";

export type TokenKind = "web" | "cli";

export const TOKEN_LIFETIMES: Record<TokenKind, { days: number; jwtExp: string }> = {
  web: { days: 7, jwtExp: "7d" },
  cli: { days: 365, jwtExp: "365d" },
};

export interface JwtPayload {
  sub: string;
  email: string;
  kind?: TokenKind;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
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
  const kind: TokenKind = payload.kind === "cli" ? "cli" : "web";
  return { sub: payload.sub, email: payload.email as string, kind };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenExpiresAt(kind: TokenKind): Date {
  const date = new Date();
  date.setDate(date.getDate() + TOKEN_LIFETIMES[kind].days);
  return date;
}
