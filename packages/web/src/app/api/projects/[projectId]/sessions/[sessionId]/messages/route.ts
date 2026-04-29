import { NextResponse } from "next/server";
import { MessageBatchSchema } from "@mytool/shared";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { handleRouteError, forbidden, notFound } from "@/lib/api-errors";

interface RouteContext {
  params: Promise<{ projectId: string; sessionId: string }>;
}

async function assertProjectAccess(authUserId: string, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { orgId: true },
  });
  if (!project) throw notFound("Project not found");
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: authUserId, orgId: project.orgId } },
  });
  if (!membership) throw forbidden();
}

export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const { projectId, sessionId } = await context.params;
    await assertProjectAccess(authUserId, projectId);

    let body;
    try {
      body = MessageBatchSchema.parse(await req.json());
    } catch {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    if (body.messages.length === 0) return NextResponse.json({ ok: true, saved: 0 });

    await prisma.$transaction(async (tx) => {
      await tx.message.deleteMany({ where: { sessionId } });
      await tx.message.createMany({
        data: body.messages.map((m, idx) => ({
          sessionId,
          role: m.role,
          content: m.content,
          orderIdx: idx,
          timestamp: new Date(m.timestamp),
        })),
      });
    });

    return NextResponse.json({ ok: true, saved: body.messages.length });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function GET(req: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const { projectId, sessionId } = await context.params;
    await assertProjectAccess(authUserId, projectId);

    const [total, messages] = await Promise.all([
      prisma.message.count({ where: { sessionId } }),
      prisma.message.findMany({
        where: { sessionId },
        orderBy: { orderIdx: "asc" },
        take: 500,
      }),
    ]);

    return NextResponse.json({
      total,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        orderIdx: m.orderIdx,
        timestamp: m.timestamp.toISOString(),
      })),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
