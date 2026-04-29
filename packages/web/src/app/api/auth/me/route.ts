import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { handleRouteError, unauthorized } from "@/lib/api-errors";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const { userId } = await requireAuth(req);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: { include: { org: true } },
      },
    });
    if (!user) throw unauthorized();

    return NextResponse.json({
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
  } catch (err) {
    return handleRouteError(err);
  }
}
