import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { handleRouteError, forbidden, notFound } from "@/lib/api-errors";

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

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      include: { _count: { select: { members: true, projects: true } } },
    });
    if (!org) throw notFound("Organization not found");

    return NextResponse.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      memberCount: org._count.members,
      projectCount: org._count.projects,
      createdAt: org.createdAt.toISOString(),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
