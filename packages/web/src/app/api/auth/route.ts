import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/db";
import { signJwt, hashToken, tokenExpiresAt, type TokenKind } from "@/lib/jwt";
import { setAuthToken } from "@/lib/auth";
import { handleRouteError, conflict, unauthorized } from "@/lib/api-errors";
import type { TokenKind as PrismaTokenKind } from "@prisma/client";

const BCRYPT_ROUNDS = 12;

const BodySchema = z.object({
  mode: z.enum(["login", "register"]),
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});

function toPrismaKind(kind: TokenKind): PrismaTokenKind {
  return kind === "cli" ? "CLI" : "WEB";
}

function deriveLabel(ua: string | null): string {
  if (!ua) return "Web";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  return "Web";
}

function generateUniqueSlug(email: string): string {
  const base = email
    .split("@")[0]!
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return `${base || "user"}-${Date.now().toString(36)}`;
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    let body;
    try {
      body = BodySchema.parse(await req.json());
    } catch {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const kind: TokenKind = "web";
    const ua = req.headers.get("user-agent");

    if (body.mode === "register") {
      const existing = await prisma.user.findUnique({ where: { email: body.email } });
      if (existing) throw conflict("Email already registered");

      const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
      const user = await prisma.user.create({
        data: {
          email: body.email,
          passwordHash,
          name: body.name ?? null,
          memberships: {
            create: {
              role: "OWNER",
              org: {
                create: {
                  name: body.name ?? body.email.split("@")[0]!,
                  slug: generateUniqueSlug(body.email),
                },
              },
            },
          },
        },
      });

      const token = await signJwt({ sub: user.id, email: user.email, kind });
      const expiresAt = tokenExpiresAt(kind);
      await prisma.cliToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          kind: toPrismaKind(kind),
          label: deriveLabel(ua),
          expiresAt,
        },
      });

      const maxAgeSeconds = Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      await setAuthToken(token, maxAgeSeconds);
      return NextResponse.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
    } else {
      const user = await prisma.user.findUnique({ where: { email: body.email } });
      if (!user) throw unauthorized("Invalid email or password");

      const ok = await bcrypt.compare(body.password, user.passwordHash);
      if (!ok) throw unauthorized("Invalid email or password");

      const token = await signJwt({ sub: user.id, email: user.email, kind });
      const expiresAt = tokenExpiresAt(kind);
      await prisma.cliToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          kind: toPrismaKind(kind),
          label: deriveLabel(ua),
          expiresAt,
        },
      });

      const maxAgeSeconds = Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      await setAuthToken(token, maxAgeSeconds);
      return NextResponse.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
    }
  } catch (err) {
    return handleRouteError(err);
  }
}
