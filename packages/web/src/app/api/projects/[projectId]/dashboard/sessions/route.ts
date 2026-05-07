import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { handleRouteError, forbidden, notFound } from "@/lib/api-errors";

const QuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  userId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(
  req: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  try {
    const { userId } = await requireAuth(req);
    const { projectId } = await context.params;
    const url = new URL(req.url);
    const q = QuerySchema.parse({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      userId: url.searchParams.get("userId") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project) throw notFound("Project not found");
    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId: project.orgId } },
    });
    if (!membership) throw forbidden();

    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    const filterUserId = q.userId;

    const where = {
      projectId,
      startedAt: { gte: from, lte: to },
      ...(filterUserId ? { userId: filterUserId } : {}),
    };

    const [total, sessions] = await Promise.all([
      prisma.claudeSession.count({ where }),
      prisma.claudeSession.findMany({
        where,
        orderBy: { startedAt: "desc" },
        take: q.limit,
        skip: q.offset,
        include: {
          user: { select: { name: true } },
          _count: { select: { events: true } },
          usageRecords: {
            select: { inputTokens: true, outputTokens: true, estimatedCostUsd: true },
          },
        },
      }),
    ]);

    return NextResponse.json({
      total,
      sessions: sessions.map((s) => {
        const tokens = s.usageRecords.reduce(
          (acc, u) => ({
            inputTokens: acc.inputTokens + u.inputTokens,
            outputTokens: acc.outputTokens + u.outputTokens,
            cost: acc.cost + Number(u.estimatedCostUsd),
          }),
          { inputTokens: 0, outputTokens: 0, cost: 0 },
        );
        return {
          id: s.id,
          userId: s.userId,
          userName: s.user.name,
          startedAt: s.startedAt.toISOString(),
          endedAt: s.endedAt?.toISOString() ?? null,
          eventCount: s._count.events,
          inputTokens: tokens.inputTokens,
          outputTokens: tokens.outputTokens,
          estimatedCostUsd: tokens.cost,
        };
      }),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
