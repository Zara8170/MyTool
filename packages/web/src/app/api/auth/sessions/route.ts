import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-errors";
import type { TokenKind as PrismaTokenKind } from "@prisma/client";

function toSharedKind(kind: PrismaTokenKind): "web" | "cli" {
  return kind === "CLI" ? "cli" : "web";
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const { userId, tokenHash: currentHash } = await requireAuth(req);
    const now = new Date();

    const tokens = await prisma.cliToken.findMany({
      where: { userId },
      orderBy: [{ revokedAt: "asc" }, { lastUsedAt: "desc" }, { createdAt: "desc" }],
    });

    const sessions = tokens.map((t) => ({
      id: t.id,
      kind: toSharedKind(t.kind),
      label: t.label,
      createdAt: t.createdAt.toISOString(),
      expiresAt: t.expiresAt.toISOString(),
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      revokedAt: t.revokedAt?.toISOString() ?? null,
      isCurrent: t.tokenHash === currentHash,
      isExpired: t.expiresAt < now,
      isActive: !t.revokedAt && t.expiresAt >= now,
    }));

    return NextResponse.json({ sessions });
  } catch (err) {
    return handleRouteError(err);
  }
}
