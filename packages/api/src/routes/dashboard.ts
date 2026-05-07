import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { MessageBatchSchema } from "@mytool/shared";
import { prisma } from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { forbidden, notFound } from "../lib/errors.js";

export const dashboardRoute = new Hono();
dashboardRoute.use("*", authMiddleware);

const QuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  userId: z.string().optional(),
});

/**
 * 프로젝트 권한 체크 + 날짜 범위 정규화 (기본 최근 30일).
 */
async function resolveDateRange(
  projectId: string,
  authUserId: string,
  q: z.infer<typeof QuerySchema>,
): Promise<{ from: Date; to: Date; userId?: string | undefined }> {
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
  const from = q.from
    ? new Date(q.from)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to, userId: q.userId };
}

/**
 * GET /api/projects/:projectId/dashboard/summary
 */
dashboardRoute.get(
  "/:projectId/dashboard/summary",
  zValidator("query", QuerySchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const userId = c.get("userId");
    const { from, to, userId: filterUserId } = await resolveDateRange(
      projectId,
      userId,
      c.req.valid("query"),
    );

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

    return c.json({
      totalSessions,
      activeUsers: activeUsersAgg.length,
      totalInputTokens: usageAgg._sum.inputTokens ?? 0,
      totalOutputTokens: usageAgg._sum.outputTokens ?? 0,
      totalCacheReadTokens: usageAgg._sum.cacheReadInputTokens ?? 0,
      totalCacheCreationTokens: usageAgg._sum.cacheCreationInputTokens ?? 0,
      estimatedCostUsd: Number(usageAgg._sum.estimatedCostUsd ?? 0),
      topSkills: (() => {
        const failMap = new Map(
          topSkillFailsRaw
            .filter((r) => r.skillName)
            .map((r) => [r.skillName!, r._count._all]),
        );
        return topSkillsRaw
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
          });
      })(),
      topAgentTypes: topAgentsRaw
        .filter((r) => r.agentType)
        .map((r) => ({ agentType: r.agentType!, callCount: r._count._all })),
    });
  },
);

/**
 * GET /api/projects/:projectId/dashboard/usage
 * 일별 토큰·비용 시계열.
 * 오늘 이전: daily_project_stats에서 읽기 (pre-aggregated)
 * 오늘: usageRecord에서 실시간 집계
 */
dashboardRoute.get(
  "/:projectId/dashboard/usage",
  zValidator("query", QuerySchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const userId = c.get("userId");
    const { from, to } = await resolveDateRange(
      projectId,
      userId,
      c.req.valid("query"),
    );

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // 오늘 이전: daily_project_stats에서 읽기
    const dailyRows = await prisma.dailyProjectStats.findMany({
      where: {
        projectId,
        date: { gte: from, lt: today },
      },
      orderBy: { date: "asc" },
    });

    // 오늘: 실시간 집계
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
        estimatedCostUsd:
          Math.round(Number(r.estimatedCostUsd) * 1_000_000) / 1_000_000,
      })),
      ...(todayUsage
        ? [
            {
              date: today.toISOString().slice(0, 10),
              inputTokens: todayUsage._sum.inputTokens ?? 0,
              outputTokens: todayUsage._sum.outputTokens ?? 0,
              cacheReadTokens: todayUsage._sum.cacheReadInputTokens ?? 0,
              cacheCreationTokens:
                todayUsage._sum.cacheCreationInputTokens ?? 0,
              estimatedCostUsd:
                Math.round(
                  Number(todayUsage._sum.estimatedCostUsd ?? 0) * 1_000_000,
                ) / 1_000_000,
            },
          ]
        : []),
    ];

    return c.json({ series });
  },
);

/**
 * GET /api/projects/:projectId/sessions/:sessionId
 * 세션 상세 + 모델별 토큰 사용량
 */
dashboardRoute.get("/:projectId/sessions/:sessionId", async (c) => {
  const projectId = c.req.param("projectId");
  const sessionId = c.req.param("sessionId");
  const authUserId = c.get("userId");

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
      cacheCreationInputTokens:
        acc.cacheCreationInputTokens + u.cacheCreationInputTokens,
      cost: acc.cost + Number(u.estimatedCostUsd),
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      cost: 0,
    },
  );

  return c.json({
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
      estimatedCostUsd:
        Math.round(u.estimatedCostUsd * 1_000_000) / 1_000_000,
    })),
    messageCount: session._count.messages,
  });
});

/**
 * GET /api/projects/:projectId/sessions/:sessionId/events
 * 세션 내 이벤트 타임라인
 */
dashboardRoute.get(
  "/:projectId/sessions/:sessionId/events",
  zValidator(
    "query",
    z.object({
      limit: z.coerce.number().int().min(1).max(500).default(200),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  ),
  async (c) => {
    const projectId = c.req.param("projectId");
    const sessionId = c.req.param("sessionId");
    const authUserId = c.get("userId");
    const q = c.req.valid("query");

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project) throw notFound("Project not found");
    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId: authUserId, orgId: project.orgId } },
    });
    if (!membership) throw forbidden();

    const where = { projectId, sessionId };
    const [total, events] = await Promise.all([
      prisma.event.count({ where }),
      prisma.event.findMany({
        where,
        orderBy: { timestamp: "asc" },
        take: q.limit,
        skip: q.offset,
        select: {
          id: true,
          hookEventName: true,
          toolName: true,
          toolInput: true,
          toolResponse: true,
          exitCode: true,
          isSkillCall: true,
          skillName: true,
          isAgentCall: true,
          agentType: true,
          agentDesc: true,
          isSlashCommand: true,
          slashCommandName: true,
          timestamp: true,
        },
      }),
    ]);

    return c.json({
      total,
      events: events.map((e) => ({
        ...e,
        timestamp: e.timestamp.toISOString(),
      })),
    });
  },
);

/**
 * GET /api/projects/:projectId/dashboard/sessions
 */
dashboardRoute.get(
  "/:projectId/dashboard/sessions",
  zValidator(
    "query",
    QuerySchema.extend({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  ),
  async (c) => {
    const projectId = c.req.param("projectId");
    const userId = c.get("userId");
    const q = c.req.valid("query");
    const { from, to, userId: filterUserId } = await resolveDateRange(
      projectId,
      userId,
      q,
    );

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
            select: {
              inputTokens: true,
              outputTokens: true,
              estimatedCostUsd: true,
            },
          },
        },
      }),
    ]);

    return c.json({
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
          outlierCount: s.outlierCount,
          outlierRatio: s.outlierRatio,
        };
      }),
    });
  },
);

/**
 * POST /api/projects/:projectId/sessions/:sessionId/messages
 * CLI가 Stop 이벤트 후 transcript 파싱 결과를 전송한다.
 * 멱등성: 기존 메시지 전체 삭제 후 재삽입.
 */
dashboardRoute.post(
  "/:projectId/sessions/:sessionId/messages",
  zValidator("json", MessageBatchSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const sessionId = c.req.param("sessionId");
    const authUserId = c.get("userId");
    const { messages } = c.req.valid("json");

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project) throw notFound("Project not found");
    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId: authUserId, orgId: project.orgId } },
    });
    if (!membership) throw forbidden();

    if (messages.length === 0) return c.json({ ok: true, saved: 0 });

    await prisma.$transaction(async (tx) => {
      await tx.message.deleteMany({ where: { sessionId } });
      await tx.message.createMany({
        data: messages.map((m, idx) => ({
          sessionId,
          role: m.role,
          content: m.content,
          orderIdx: idx,
          timestamp: new Date(m.timestamp),
        })),
      });
    });

    return c.json({ ok: true, saved: messages.length });
  },
);

/**
 * GET /api/projects/:projectId/sessions/:sessionId/messages
 * 세션 대화 내역 조회
 */
dashboardRoute.get("/:projectId/sessions/:sessionId/messages", async (c) => {
  const projectId = c.req.param("projectId");
  const sessionId = c.req.param("sessionId");
  const authUserId = c.get("userId");

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { orgId: true },
  });
  if (!project) throw notFound("Project not found");
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: authUserId, orgId: project.orgId } },
  });
  if (!membership) throw forbidden();

  const [total, messages] = await Promise.all([
    prisma.message.count({ where: { sessionId } }),
    prisma.message.findMany({
      where: { sessionId },
      orderBy: { orderIdx: "asc" },
      take: 500,
    }),
  ]);

  return c.json({
    total,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      orderIdx: m.orderIdx,
      timestamp: m.timestamp.toISOString(),
    })),
  });
});
