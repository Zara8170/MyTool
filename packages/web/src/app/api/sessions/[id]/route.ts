import { NextResponse } from "next/server";
import { getAuthToken } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hashToken, verifyJwt } from "@/lib/jwt";
import { handleRouteError, notFound, forbidden, unauthorized } from "@/lib/api-errors";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(_req: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const cookieToken = await getAuthToken();
    if (!cookieToken) throw unauthorized();

    let payload;
    try {
      payload = await verifyJwt(cookieToken);
    } catch {
      throw unauthorized("Invalid or expired token");
    }
    const userId = payload.sub;
    const callerHash = hashToken(cookieToken);

    const dbCaller = await prisma.cliToken.findUnique({
      where: { tokenHash: callerHash },
      select: { revokedAt: true, expiresAt: true },
    });
    if (dbCaller?.revokedAt || (dbCaller && dbCaller.expiresAt < new Date())) {
      throw unauthorized("Token has been revoked or expired");
    }

    const { id } = await context.params;
    const token = await prisma.cliToken.findUnique({ where: { id } });
    if (!token) throw notFound("Session not found");
    if (token.userId !== userId) throw forbidden("Not your session");

    if (token.revokedAt) {
      return NextResponse.json({ ok: true, alreadyRevoked: true });
    }

    await prisma.cliToken.update({ where: { id }, data: { revokedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
