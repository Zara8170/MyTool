import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { handleRouteError, forbidden, notFound } from "@/lib/api-errors";

interface RouteContext {
  params: Promise<{ projectId: string; sessionId: string }>;
}

export async function GET(req: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const { projectId, sessionId } = await context.params;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project) throw notFound("Project not found");
    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId: authUserId, orgId: project.orgId } },
    });
    if (!membership) throw forbidden();

    const session = await prisma.claudeSession.findUnique({
      where: { id: sessionId, projectId },
      include: {
        user: { select: { name: true } },
        _count: { select: { events: true, messages: true } },
        usageRecords: {
          select: {
            model: true,
            inputTokens: true,
            outputTokens: true,
            cacheReadInputTokens: true,
            cacheCreationInputTokens: true,
            estimatedCostUsd: true,
            isSubagent: true,
          },
        },
      },
    });
    if (!session) throw notFound("Session not found");

    const modelMap = new Map<
      string,
      {
        inputTokens: number;
        outputTokens: number;
        cacheReadInputTokens: number;
        cacheCreationInputTokens: number;
        estimatedCostUsd: number;
        isSubagent: boolean;
      }
    >();
    for (const u of session.usageRecords) {
      const existing = modelMap.get(u.model) ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        estimatedCostUsd: 0,
        isSubagent: u.isSubagent,
      };
      existing.inputTokens += u.inputTokens;
      existing.outputTokens += u.outputTokens;
      existing.cacheReadInputTokens += u.cacheReadInputTokens;
      existing.cacheCreationInputTokens += u.cacheCreationInputTokens;
      existing.estimatedCostUsd += Number(u.estimatedCostUsd);
      modelMap.set(u.model, existing);
    }

    const totals = session.usageRecords.reduce(
      (acc, u) => ({
        inputTokens: acc.inputTokens + u.inputTokens,
        outputTokens: acc.outputTokens + u.outputTokens,
        cacheReadInputTokens: acc.cacheReadInputTokens + u.cacheReadInputTokens,
        cacheCreationInputTokens: acc.cacheCreationInputTokens + u.cacheCreationInputTokens,
        cost: acc.cost + Number(u.estimatedCostUsd),
      }),
      { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cost: 0 },
    );

    return NextResponse.json({
      id: session.id,
      userId: session.userId,
      userName: session.user.name,
      projectId: session.projectId,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      eventCount: session._count.events,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheReadInputTokens: totals.cacheReadInputTokens,
      cacheCreationInputTokens: totals.cacheCreationInputTokens,
      estimatedCostUsd: totals.cost,
      usageByModel: Array.from(modelMap.entries()).map(([model, u]) => ({
        model,
        ...u,
        estimatedCostUsd: Math.round(u.estimatedCostUsd * 1_000_000) / 1_000_000,
      })),
      messageCount: session._count.messages,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
