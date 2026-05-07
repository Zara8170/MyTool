import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthToken } from "@/lib/auth";
import { verifyJwt } from "@/lib/jwt";
import { PatchProjectSchema } from "@mytool/shared";
import { handleRouteError, forbidden, notFound, unauthorized, badRequest } from "@/lib/api-errors";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

/**
 * 브라우저용 라우트는 httpOnly 쿠키 기반 인증을 사용한다.
 * (CLI 용 Bearer 토큰 인증은 packages/api 의 Hono 라우트가 담당.)
 */
async function requireWebAuth(): Promise<{ userId: string }> {
  const token = await getAuthToken();
  if (!token) throw unauthorized("Not authenticated");
  try {
    const payload = await verifyJwt(token);
    return { userId: payload.sub };
  } catch {
    throw unauthorized("Invalid token");
  }
}

export async function DELETE(_req: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { userId } = await requireWebAuth();
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

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { userId } = await requireWebAuth();
    const { projectId } = await context.params;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        orgId: true,
        name: true,
        slug: true,
        createdAt: true,
        syncEnabled: true,
        harnessEnabled: true,
        harnessConfig: true,
      },
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
      syncEnabled: project.syncEnabled,
      harnessEnabled: project.harnessEnabled,
      harnessConfig: project.harnessConfig,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * PATCH /api/projects/:projectId
 * 4축 워크스페이스 토글·설정 갱신 (integration-plan §0, PR 1).
 */
export async function PATCH(req: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { userId } = await requireWebAuth();
    const { projectId } = await context.params;

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw badRequest("Invalid JSON body");
    }
    const parsed = PatchProjectSchema.safeParse(json);
    if (!parsed.success) {
      throw badRequest("Validation failed", parsed.error.flatten());
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, orgId: true },
    });
    if (!project) throw notFound("Project not found");

    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId: project.orgId } },
    });
    if (!membership) throw forbidden("Not a member of this project's organization");

    const data: Record<string, unknown> = {};
    const patch = parsed.data;
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.syncEnabled !== undefined) data.syncEnabled = patch.syncEnabled;
    if (patch.harnessEnabled !== undefined) data.harnessEnabled = patch.harnessEnabled;
    if (patch.harnessConfig !== undefined) {
      data.harnessConfig = patch.harnessConfig === null ? null : (patch.harnessConfig as object);
    }

    const updated =
      Object.keys(data).length === 0
        ? await prisma.project.findUnique({ where: { id: projectId } })
        : await prisma.project.update({ where: { id: projectId }, data });
    if (!updated) throw notFound("Project not found");

    return NextResponse.json({
      id: updated.id,
      orgId: updated.orgId,
      name: updated.name,
      slug: updated.slug,
      createdAt: updated.createdAt.toISOString(),
      syncEnabled: updated.syncEnabled,
      harnessEnabled: updated.harnessEnabled,
      harnessConfig: updated.harnessConfig,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
