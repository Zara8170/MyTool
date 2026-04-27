import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { calculateCost, IngestEventSchema } from "@mytool/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimit, userKey } from "../middleware/rate-limit.js";
import { forbidden, notFound } from "../lib/errors.js";
import {
  parseEventDerivations,
  truncateToolPayload,
} from "../lib/events.js";
import { computeSessionOutlierStats } from "../lib/outlier.js";
import { updateProjectToolBaselines } from "../lib/baseline.js";
import { upsertDailyProjectStats } from "../lib/daily-stats.js";

export const eventsRoute = new Hono();

// 인증 통과 후 사용자별 분당 600회 제한 (=초당 10회).
// 정상 hook 발화 빈도보다 훨씬 여유롭지만 폭주는 차단.
const ingestLimiter = rateLimit({
  windowMs: 60_000,
  max: 600,
  bucket: "events",
  key: userKey("events"),
});

eventsRoute.use("*", authMiddleware);
eventsRoute.use("*", ingestLimiter);

/**
 * POST /api/events
 *
 * 처리 흐름:
 *   1. 프로젝트 존재 + 사용자 멤버십 확인
 *   2. ClaudeSession upsert (session_id로 중복 방지)
 *   3. 파생 필드 (isSkillCall 등) 계산
 *   4. Event 저장
 *   5. Stop/SubagentStop 이벤트 + usage 있으면 UsageRecord 생성
 *   6. 즉시 202 응답 (transcript 깊은 파싱은 서버 비동기로)
 *
 * 모든 DB 쓰기는 가능한 한 단일 트랜잭션으로 묶어 일관성을 유지합니다.
 */
eventsRoute.post(
  "/",
  zValidator("json", IngestEventSchema),
  async (c) => {
    const userId = c.get("userId");
    const event = c.req.valid("json");

    // 1. 권한 체크 — 프로젝트의 org에 사용자가 속해있는지
    const project = await prisma.project.findUnique({
      where: { id: event.projectId },
      select: { id: true, orgId: true },
    });
    if (!project) throw notFound("Project not found");

    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId: project.orgId } },
    });
    if (!membership) throw forbidden("Not a member of this project's organization");

    // 2-4. 단일 트랜잭션
    const derivations = parseEventDerivations(
      event.toolName,
      event.toolInput,
    );
    const eventTimestamp = new Date(event.timestamp);

    await prisma.$transaction(async (tx) => {
      // ClaudeSession upsert
      await tx.claudeSession.upsert({
        where: { id: event.sessionId },
        create: {
          id: event.sessionId,
          projectId: event.projectId,
          userId,
          startedAt: eventTimestamp,
          endedAt:
            event.hookEventName === "Stop" ||
            event.hookEventName === "SubagentStop"
              ? eventTimestamp
              : null,
        },
        update: {
          // 진행 중인 세션은 Stop 이벤트가 와야 endedAt 갱신
          ...(event.hookEventName === "Stop" ||
          event.hookEventName === "SubagentStop"
            ? { endedAt: eventTimestamp }
            : {}),
        },
      });

      // Event 저장
      await tx.event.create({
        data: {
          projectId: event.projectId,
          sessionId: event.sessionId,
          userId,
          hookEventName: event.hookEventName,
          toolName: event.toolName ?? null,
          toolInput: truncateToolPayload(event.toolInput),
          toolResponse: truncateToolPayload(event.toolResponse),
          exitCode: event.exitCode ?? null,
          isSkillCall: derivations.isSkillCall,
          skillName: derivations.skillName,
          isAgentCall: derivations.isAgentCall,
          agentType: derivations.agentType,
          agentDesc: derivations.agentDesc,
          isSlashCommand: event.isSlashCommand ?? false,
          slashCommandName: event.slashCommandName ?? null,
          agentId: event.agentId ?? null,
          rawPayload:
            event.rawPayload === undefined
              ? Prisma.JsonNull
              : (event.rawPayload as Prisma.InputJsonValue),
          timestamp: eventTimestamp,
        },
      });

      // 5. Usage 데이터가 함께 왔으면 UsageRecord 생성
      if (event.usage) {
        const cost = calculateCost({
          model: event.usage.model,
          inputTokens: event.usage.inputTokens,
          outputTokens: event.usage.outputTokens,
          cacheCreationTokens: event.usage.cacheCreationTokens,
          cacheReadTokens: event.usage.cacheReadTokens,
        });
        await tx.usageRecord.create({
          data: {
            projectId: event.projectId,
            sessionId: event.sessionId,
            userId,
            model: event.usage.model ?? "unknown",
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
            cacheCreationInputTokens: event.usage.cacheCreationTokens,
            cacheReadInputTokens: event.usage.cacheReadTokens,
            estimatedCostUsd: new Prisma.Decimal(cost.toFixed(6)),
            isSubagent: event.usage.isSubagent,
            recordedAt: eventTimestamp,
          },
        });
      }
    });

    // 6. Stop 이벤트면 이상치 통계를 비동기로 집계 (202 응답 지연 없이)
    if (
      event.hookEventName === "Stop" ||
      event.hookEventName === "SubagentStop"
    ) {
      computeSessionOutlierStats(event.sessionId, event.projectId)
        .then((stats) =>
          prisma.claudeSession.update({
            where: { id: event.sessionId },
            data: {
              outlierCount: stats.outlierCount,
              outlierRatio: stats.outlierRatio,
            },
          }),
        )
        .catch((err) => {
          console.warn("[outlier] aggregation failed", { sessionId: event.sessionId, err });
        });

      updateProjectToolBaselines(event.projectId).catch((err) => {
        console.warn("[baseline] update failed", { projectId: event.projectId, err });
      });

      upsertDailyProjectStats(event.projectId, new Date(event.timestamp)).catch((err) => {
        console.warn("[daily-stats] update failed", { projectId: event.projectId, err });
      });
    }

    return c.json({ ok: true }, 202);
  },
);
