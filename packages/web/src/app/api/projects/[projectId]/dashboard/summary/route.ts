import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { handleRouteError, forbidden, notFound } from "@/lib/api-errors";

const QuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  userId: z.string().optional(),
});

async function resolveDateRange(
  projectId: string,
  authUserId: string,
  q: z.infer<typeof QuerySchema>,
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { orgId: true },
  });
  if (!project) throw notFound("Project not found");
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: authUserId, orgId: project.orgId } },
  });
  if (!membership) throw forbidden();
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to, userId: q.userId };
}

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
    });
    const { from, to, userId: filterUserId } = await resolveDateRange(projectId, userId, q);
    const userFilter = filterUserId ? { userId: filterUserId } : {};

    const [totalSessions, activeUsersAgg, usageAgg, topSkillsRaw, topAgentsRaw, topSkillFailsRaw] =
      await Promise.all([
        prisma.claudeSession.count({
          where: { projectId, startedAt: { gte: from, lte: to }, ...userFilter },
        }),
        prisma.event.findMany({
          where: { projectId, timestamp: { gte: from, lte: to }, ...userFilter },
          distinct: ["userId"],
          select: { userId: true },
        }),
        prisma.usageRecord.aggregate({
          where: { projectId, recordedAt: { gte: from, lte: to }, ...userFilter },
          _sum: {
            inputTokens: true,
            outputTokens: true,
            cacheReadInputTokens: true,
            cacheCreationInputTokens: true,
            estimatedCostUsd: true,
          },
        }),
        prisma.event.groupBy({
          by: ["skillName"],
          where: {
            projectId,
            timestamp: { gte: from, lte: to },
            isSkillCall: true,
            skillName: { not: null },
            ...userFilter,
          },
          _count: { _all: true },
          orderBy: { _count: { skillName: "desc" } },
          take: 10,
        }),
        prisma.event.groupBy({
          by: ["agentType"],
          where: {
            projectId,
            timestamp: { gte: from, lte: to },
            isAgentCall: true,
            agentType: { not: null },
            ...userFilter,
          },
          _count: { _all: true },
          orderBy: { _count: { agentType: "desc" } },
          take: 10,
        }),
        prisma.event.groupBy({
          by: ["skillName"],
          where: {
            projectId,
            timestamp: { gte: from, lte: to },
            isSkillCall: true,
            skillName: { not: null },
            exitCode: { not: 0 },
            ...userFilter,
          },
          _count: { _all: true },
        }),
      ]);

    const failMap = new Map(
      topSkillFailsRaw.filter((r) => r.skillName).map((r) => [r.skillName!, r._count._all]),
    );

    return NextResponse.json({
      totalSessions,
      activeUsers: activeUsersAgg.length,
      totalInputTokens: usageAgg._sum.inputTokens ?? 0,
      totalOutputTokens: usageAgg._sum.outputTokens ?? 0,
      totalCacheReadTokens: usageAgg._sum.cacheReadInputTokens ?? 0,
      totalCacheCreationTokens: usageAgg._sum.cacheCreationInputTokens ?? 0,
      estimatedCostUsd: Number(usageAgg._sum.estimatedCostUsd ?? 0),
      topSkills: topSkillsRaw
        .filter((r) => r.skillName)
        .map((r) => {
          const total = r._count._all;
          const failed = failMap.get(r.skillName!) ?? 0;
          return {
            skillName: r.skillName!,
            callCount: total,
            failedCount: failed,
            failureRate: total > 0 ? failed / total : 0,
          };
        }),
      topAgentTypes: topAgentsRaw
        .filter((r) => r.agentType)
        .map((r) => ({ agentType: r.agentType!, callCount: r._count._all })),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
