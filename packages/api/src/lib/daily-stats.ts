import { prisma } from "../db.js";

/**
 * 특정 날짜의 프로젝트 통계를 계산해 upsert한다.
 * Stop 이벤트 수신 시 해당 날짜(UTC)를 대상으로 비동기 호출된다.
 */
export async function upsertDailyProjectStats(
  projectId: string,
  date: Date,
): Promise<void> {
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const [sessionsResult, usageResult, activeUsersResult] = await Promise.all([
    prisma.claudeSession.count({
      where: {
        projectId,
        startedAt: { gte: dayStart, lt: dayEnd },
      },
    }),
    prisma.usageRecord.aggregate({
      where: {
        projectId,
        recordedAt: { gte: dayStart, lt: dayEnd },
      },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheReadInputTokens: true,
        cacheCreationInputTokens: true,
        estimatedCostUsd: true,
      },
    }),
    prisma.event.findMany({
      where: {
        projectId,
        timestamp: { gte: dayStart, lt: dayEnd },
      },
      distinct: ["userId"],
      select: { userId: true },
    }),
  ]);

  const dateOnly = new Date(dayStart);

  await prisma.dailyProjectStats.upsert({
    where: { projectId_date: { projectId, date: dateOnly } },
    create: {
      projectId,
      date: dateOnly,
      sessionCount: sessionsResult,
      activeUsers: activeUsersResult.length,
      inputTokens: usageResult._sum.inputTokens ?? 0,
      outputTokens: usageResult._sum.outputTokens ?? 0,
      cacheReadTokens: usageResult._sum.cacheReadInputTokens ?? 0,
      cacheCreationTokens: usageResult._sum.cacheCreationInputTokens ?? 0,
      estimatedCostUsd: usageResult._sum.estimatedCostUsd ?? 0,
    },
    update: {
      sessionCount: sessionsResult,
      activeUsers: activeUsersResult.length,
      inputTokens: usageResult._sum.inputTokens ?? 0,
      outputTokens: usageResult._sum.outputTokens ?? 0,
      cacheReadTokens: usageResult._sum.cacheReadInputTokens ?? 0,
      cacheCreationTokens: usageResult._sum.cacheCreationInputTokens ?? 0,
      estimatedCostUsd: usageResult._sum.estimatedCostUsd ?? 0,
    },
  });
}
