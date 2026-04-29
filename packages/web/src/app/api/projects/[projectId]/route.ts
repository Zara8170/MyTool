import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { handleRouteError, forbidden, notFound } from "@/lib/api-errors";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(req: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { userId } = await requireAuth(req);
    const { projectId } = await context.params;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, orgId: true, name: true, slug: true, createdAt: true },
    });
    if (!project) throw notFound("Project not found");

    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId: project.orgId } },
    });
    if (!membership) throw forbidden("Not a member of this project's organization");

    return NextResponse.json({
      id: project.id,
      orgId: project.orgId,
      name: project.name,
      slug: project.slug,
      createdAt: project.createdAt.toISOString(),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
