import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { getAuthToken } from "@/lib/auth";
import { verifyJwt } from "@/lib/jwt";
import { handleRouteError, forbidden, notFound, unauthorized } from "@/lib/api-errors";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export async function DELETE(_req: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const token = await getAuthToken();
    if (!token) throw unauthorized("Not authenticated");
    let userId: string;
    try {
      const payload = await verifyJwt(token);
      userId = payload.sub;
    } catch {
      throw unauthorized("Invalid token");
    }
    const { projectId } = await context.params;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, orgId: true },
    });
    if (!project) throw notFound("Project not found");

    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId: project.orgId } },
    });
    if (!membership) throw forbidden("Not a member of this project's organization");
    if (membership.role !== "OWNER") throw forbidden("Only owners can delete projects");

    await prisma.project.delete({ where: { id: projectId } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
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
