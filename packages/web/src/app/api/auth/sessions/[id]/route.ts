import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { handleRouteError, notFound, forbidden } from "@/lib/api-errors";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(req: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { userId } = await requireAuth(req);
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
