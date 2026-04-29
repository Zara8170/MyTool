import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { handleRouteError, forbidden } from "@/lib/api-errors";

interface RouteContext {
  params: Promise<{ orgId: string }>;
}

export async function GET(req: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { userId } = await requireAuth(req);
    const { orgId } = await context.params;

    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });
    if (!membership) throw forbidden("Not a member of this organization");

    const projects = await prisma.project.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
