import "server-only";
import { redirect } from "next/navigation";
import { getAuthToken } from "./auth";
import { verifyJwt, hashToken } from "./jwt";
import { prisma } from "./db";

// Returns userId, redirects to /login if token missing/invalid
export async function getRequiredUserId(): Promise<string> {
  const token = await getAuthToken();
  if (!token) redirect("/login");
  try {
    const payload = await verifyJwt(token);
    return payload.sub;
  } catch {
    redirect("/login");
  }
}

// Returns { userId, tokenHash }
export async function getRequiredAuth(): Promise<{ userId: string; tokenHash: string }> {
  const token = await getAuthToken();
  if (!token) redirect("/login");
  try {
    const payload = await verifyJwt(token);
    return { userId: payload.sub, tokenHash: hashToken(token) };
  } catch {
    redirect("/login");
  }
}

// Check project membership, redirect if unauthorized
async function checkProjectAccess(projectId: string, userId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { orgId: true, name: true },
  });
  if (!project) redirect("/settings");
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId: project.orgId } },
  });
  if (!membership) redirect("/settings");
  return project;
}

// For dashboard layout: user email + project name
export async function getLayoutData(projectId: string, userId: string) {
  const [user, project] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, slug: true, orgId: true } }),
  ]);
  if (!user || !project) redirect("/login");
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId: project.orgId } },
  });
  if (!membership) redirect("/settings");
  return { userEmail: user.email, project };
}

// Dashboard summary (last 30 days)
export async function getDashboardSummary(projectId: string, userId: string) {
  await checkProjectAccess(projectId, userId);
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [totalSessions, activeUsersAgg, usageAgg, topSkillsRaw, topAgentsRaw, topSkillFailsRaw] =
    await Promise.all([
      prisma.claudeSession.count({ where: { projectId, startedAt: { gte: from, lte: to } } }),
      prisma.event.findMany({
        where: { projectId, timestamp: { gte: from, lte: to } },
        distinct: ["userId"],
        select: { userId: true },
      }),
      prisma.usageRecord.aggregate({
        where: { projectId, recordedAt: { gte: from, lte: to } },
        _sum: {
          inputTokens: true, outputTokens: true,
          cacheReadInputTokens: true, cacheCreationInputTokens: true,
          estimatedCostUsd: true,
        },
      }),
      prisma.event.groupBy({
        by: ["skillName"],
        where: { projectId, timestamp: { gte: from, lte: to }, isSkillCall: true, skillName: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { skillName: "desc" } },
        take: 10,
      }),
      prisma.event.groupBy({
        by: ["agentType"],
        where: { projectId, timestamp: { gte: from, lte: to }, isAgentCall: true, agentType: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { agentType: "desc" } },
        take: 10,
      }),
      prisma.event.groupBy({
        by: ["skillName"],
        where: { projectId, timestamp: { gte: from, lte: to }, isSkillCall: true, skillName: { not: null }, exitCode: { not: 0 } },
        _count: { _all: true },
      }),
    ]);

  const failMap = new Map(
    topSkillFailsRaw.filter((r) => r.skillName).map((r) => [r.skillName!, r._count._all]),
  );

  return {
    totalSessions,
    activeUsers: activeUsersAgg.length,
    totalInputTokens: usageAgg._sum.inputTokens ?? 0,
    totalOutputTokens: usageAgg._sum.outputTokens ?? 0,
    totalCacheReadTokens: usageAgg._sum.cacheReadInputTokens ?? 0,
    totalCacheCreationTokens: usageAgg._sum.cacheCreationInputTokens ?? 0,
    estimatedCostUsd: Number(usageAgg._sum.estimatedCostUsd ?? 0),
    topSkills: topSkillsRaw.filter((r) => r.skillName).map((r) => {
      const total = r._count._all;
      const failed = failMap.get(r.skillName!) ?? 0;
      return { skillName: r.skillName!, callCount: total, failedCount: failed, failureRate: total > 0 ? failed / total : 0 };
    }),
    topAgentTypes: topAgentsRaw.filter((r) => r.agentType).map((r) => ({ agentType: r.agentType!, callCount: r._count._all })),
    outliersByTool: outliersByToolRaw.map((r) => ({
      toolName: r.toolName,
      occurrences: r._count.id,
      avgDurationMs: Math.round(r._avg.durationMs ?? 0),
      maxDurationMs: r._max.durationMs ?? 0,
    })),
  };
}

// Usage series (last 30 days)
export async function getUsageSeries(projectId: string, userId: string) {
  await checkProjectAccess(projectId, userId);
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const dailyRows = await prisma.dailyProjectStats.findMany({
    where: { projectId, date: { gte: from, lt: today } },
    orderBy: { date: "asc" },
  });

  const todayEnd = new Date(today);
  todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);
  const todayUsage = await prisma.usageRecord.aggregate({
    where: { projectId, recordedAt: { gte: today, lt: todayEnd } },
    _sum: { inputTokens: true, outputTokens: true, cacheReadInputTokens: true, cacheCreationInputTokens: true, estimatedCostUsd: true },
  });

  return {
    series: [
      ...dailyRows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        inputTokens: Number(r.inputTokens),
        outputTokens: Number(r.outputTokens),
        cacheReadTokens: Number(r.cacheReadTokens),
        cacheCreationTokens: Number(r.cacheCreationTokens),
        estimatedCostUsd: Math.round(Number(r.estimatedCostUsd) * 1_000_000) / 1_000_000,
      })),
      {
        date: today.toISOString().slice(0, 10),
        inputTokens: todayUsage._sum.inputTokens ?? 0,
        outputTokens: todayUsage._sum.outputTokens ?? 0,
        cacheReadTokens: todayUsage._sum.cacheReadInputTokens ?? 0,
        cacheCreationTokens: todayUsage._sum.cacheCreationInputTokens ?? 0,
        estimatedCostUsd: Math.round(Number(todayUsage._sum.estimatedCostUsd ?? 0) * 1_000_000) / 1_000_000,
      },
    ],
  };
}

// Session list (last 30 days)
export async function getSessionList(projectId: string, userId: string, limit = 50) {
  await checkProjectAccess(projectId, userId);
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const where = { projectId, startedAt: { gte: from, lte: to } };

  const [total, sessions] = await Promise.all([
    prisma.claudeSession.count({ where }),
    prisma.claudeSession.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: limit,
      include: {
        user: { select: { name: true } },
        _count: { select: { events: true } },
        usageRecords: { select: { inputTokens: true, outputTokens: true, estimatedCostUsd: true } },
      },
    }),
  ]);

  return {
    total,
    sessions: sessions.map((s) => {
      const tokens = s.usageRecords.reduce(
        (acc, u) => ({ inputTokens: acc.inputTokens + u.inputTokens, outputTokens: acc.outputTokens + u.outputTokens, cost: acc.cost + Number(u.estimatedCostUsd) }),
        { inputTokens: 0, outputTokens: 0, cost: 0 },
      );
      return {
        id: s.id, userId: s.userId, userName: s.user.name,
        startedAt: s.startedAt.toISOString(), endedAt: s.endedAt?.toISOString() ?? null,
        eventCount: s._count.events, inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens, estimatedCostUsd: tokens.cost,
        outlierCount: s.outlierCount, outlierRatio: s.outlierRatio,
      };
    }),
  };
}

// Session detail
export async function getSessionDetail(projectId: string, sessionId: string, userId: string) {
  await checkProjectAccess(projectId, userId);

  const session = await prisma.claudeSession.findUnique({
    where: { id: sessionId, projectId },
    include: {
      user: { select: { name: true } },
      _count: { select: { events: true, messages: true } },
      usageRecords: {
        select: { model: true, inputTokens: true, outputTokens: true, cacheReadInputTokens: true, cacheCreationInputTokens: true, estimatedCostUsd: true, isSubagent: true },
      },
    },
  });
  if (!session) redirect(`/dashboard/${projectId}/sessions`);

  const modelMap = new Map<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; estimatedCostUsd: number; isSubagent: boolean }>();
  for (const u of session.usageRecords) {
    const existing = modelMap.get(u.model) ?? { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, estimatedCostUsd: 0, isSubagent: u.isSubagent };
    existing.inputTokens += u.inputTokens;
    existing.outputTokens += u.outputTokens;
    existing.cacheReadInputTokens += u.cacheReadInputTokens;
    existing.cacheCreationInputTokens += u.cacheCreationInputTokens;
    existing.estimatedCostUsd += Number(u.estimatedCostUsd);
    modelMap.set(u.model, existing);
  }

  const totals = session.usageRecords.reduce(
    (acc, u) => ({ inputTokens: acc.inputTokens + u.inputTokens, outputTokens: acc.outputTokens + u.outputTokens, cacheReadInputTokens: acc.cacheReadInputTokens + u.cacheReadInputTokens, cacheCreationInputTokens: acc.cacheCreationInputTokens + u.cacheCreationInputTokens, cost: acc.cost + Number(u.estimatedCostUsd) }),
    { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cost: 0 },
  );

  const [baselines, sessionOutliers] = await Promise.all([
    prisma.projectToolBaseline.findMany({ where: { projectId }, select: { toolName: true, p50Ms: true } }),
    prisma.sessionOutlierEvent.findMany({ where: { sessionId }, select: { toolName: true, medianMs: true } }),
  ]);

  const baselineMap = new Map(baselines.map((b) => [b.toolName, b.p50Ms]));
  const sessionMedians = new Map<string, number>();
  for (const o of sessionOutliers) {
    if (!sessionMedians.has(o.toolName)) sessionMedians.set(o.toolName, o.medianMs);
  }

  const baselineComparison = [...sessionMedians.entries()]
    .filter(([toolName]) => baselineMap.has(toolName))
    .map(([toolName, sessionMedianMs]) => ({
      toolName, sessionMedianMs,
      projectP50Ms: baselineMap.get(toolName)!,
      ratio: Math.round((sessionMedianMs / baselineMap.get(toolName)!) * 10) / 10,
    }))
    .filter((b) => b.ratio > 1.5)
    .sort((a, b) => b.ratio - a.ratio);

  return {
    id: session.id, userId: session.userId, userName: session.user.name,
    projectId: session.projectId,
    startedAt: session.startedAt.toISOString(), endedAt: session.endedAt?.toISOString() ?? null,
    eventCount: session._count.events, messageCount: session._count.messages,
    inputTokens: totals.inputTokens, outputTokens: totals.outputTokens,
    cacheReadInputTokens: totals.cacheReadInputTokens, cacheCreationInputTokens: totals.cacheCreationInputTokens,
    estimatedCostUsd: totals.cost,
    outlierCount: session.outlierCount, outlierRatio: session.outlierRatio,
    usageByModel: Array.from(modelMap.entries()).map(([model, u]) => ({
      model, ...u, estimatedCostUsd: Math.round(u.estimatedCostUsd * 1_000_000) / 1_000_000,
    })),
    baselineComparison,
  };
}

// Session events
export async function getSessionEvents(projectId: string, sessionId: string, userId: string, limit = 500) {
  await checkProjectAccess(projectId, userId);
  const where = { projectId, sessionId };
  const [total, events] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      orderBy: { timestamp: "asc" },
      take: limit,
      select: {
        id: true, hookEventName: true, toolName: true, toolInput: true, toolResponse: true,
        exitCode: true, isSkillCall: true, skillName: true, isAgentCall: true,
        agentType: true, agentDesc: true, isSlashCommand: true, slashCommandName: true, timestamp: true,
      },
    }),
  ]);
  return { total, events: events.map((e) => ({ ...e, timestamp: e.timestamp.toISOString() })) };
}

// Session messages
export async function getSessionMessages(sessionId: string) {
  const [total, messages] = await Promise.all([
    prisma.message.count({ where: { sessionId } }),
    prisma.message.findMany({
      where: { sessionId },
      orderBy: { orderIdx: "asc" },
      select: { id: true, role: true, content: true, orderIdx: true, timestamp: true },
    }),
  ]);
  return {
    total,
    messages: messages.map((m) => ({ ...m, timestamp: m.timestamp.toISOString() })),
  };
}

// User tokens for settings/sessions page
export async function getUserTokens(userId: string, currentTokenHash: string) {
  const now = new Date();
  const tokens = await prisma.cliToken.findMany({
    where: { userId },
    orderBy: [{ revokedAt: "asc" }, { lastUsedAt: "desc" }, { createdAt: "desc" }],
  });
  return tokens.map((t) => ({
    id: t.id,
    kind: (t.kind === "CLI" ? "cli" : "web") as "web" | "cli",
    label: t.label,
    createdAt: t.createdAt.toISOString(),
    expiresAt: t.expiresAt.toISOString(),
    lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    revokedAt: t.revokedAt?.toISOString() ?? null,
    isCurrent: t.tokenHash === currentTokenHash,
    isExpired: t.expiresAt < now,
    isActive: !t.revokedAt && t.expiresAt >= now,
  }));
}
