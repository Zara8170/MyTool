import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { handleRouteError, forbidden, notFound } from "@/lib/api-errors";

const QuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
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

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const dailyRows = await prisma.dailyProjectStats.findMany({
      where: { projectId, date: { gte: from, lt: today } },
      orderBy: { date: "asc" },
    });

    const todayEnd = new Date(today);
    todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);
    const todayUsage =
      to >= today
        ? await prisma.usageRecord.aggregate({
            where: { projectId, recordedAt: { gte: today, lt: todayEnd } },
            _sum: {
              inputTokens: true,
              outputTokens: true,
              cacheReadInputTokens: true,
              cacheCreationInputTokens: true,
              estimatedCostUsd: true,
            },
          })
        : null;

    const series = [
      ...dailyRows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        inputTokens: Number(r.inputTokens),
        outputTokens: Number(r.outputTokens),
        cacheReadTokens: Number(r.cacheReadTokens),
        cacheCreationTokens: Number(r.cacheCreationTokens),
        estimatedCostUsd: Math.round(Number(r.estimatedCostUsd) * 1_000_000) / 1_000_000,
      })),
      ...(todayUsage
        ? [
            {
              date: today.toISOString().slice(0, 10),
              inputTokens: todayUsage._sum.inputTokens ?? 0,
              outputTokens: todayUsage._sum.outputTokens ?? 0,
              cacheReadTokens: todayUsage._sum.cacheReadInputTokens ?? 0,
              cacheCreationTokens: todayUsage._sum.cacheCreationInputTokens ?? 0,
              estimatedCostUsd:
                Math.round(Number(todayUsage._sum.estimatedCostUsd ?? 0) * 1_000_000) / 1_000_000,
            },
          ]
        : []),
    ];

    return NextResponse.json({ series });
  } catch (err) {
    return handleRouteError(err);
  }
}
