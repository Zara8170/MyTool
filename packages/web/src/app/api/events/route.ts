import { NextResponse } from "next/server";
import { IngestEventSchema, calculateCost } from "@mytool/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { handleRouteError, notFound, forbidden } from "@/lib/api-errors";
import { parseEventDerivations, truncateToolPayload } from "@/lib/events-utils";
import { computeSessionOutlierStats } from "@/lib/outlier";
import { updateProjectToolBaselines } from "@/lib/baseline";
import { upsertDailyProjectStats } from "@/lib/daily-stats";

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { userId } = await requireAuth(req);

    let event;
    try {
      event = IngestEventSchema.parse(await req.json());
    } catch {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { id: event.projectId },
      select: { id: true, orgId: true },
    });
    if (!project) throw notFound("Project not found");

    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId: project.orgId } },
    });
    if (!membership) throw forbidden("Not a member of this project's organization");

    const derivations = parseEventDerivations(event.toolName, event.toolInput);
    const eventTimestamp = new Date(event.timestamp);

    await prisma.$transaction(async (tx) => {
      await tx.claudeSession.upsert({
        where: { id: event.sessionId },
        create: {
          id: event.sessionId,
          projectId: event.projectId,
          userId,
          startedAt: eventTimestamp,
          endedAt:
            event.hookEventName === "Stop" || event.hookEventName === "SubagentStop"
              ? eventTimestamp
              : null,
        },
        update: {
          ...(event.hookEventName === "Stop" || event.hookEventName === "SubagentStop"
            ? { endedAt: eventTimestamp }
            : {}),
        },
      });

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

    if (event.hookEventName === "Stop" || event.hookEventName === "SubagentStop") {
      computeSessionOutlierStats(event.sessionId, event.projectId)
        .then((stats) =>
          prisma.claudeSession.update({
            where: { id: event.sessionId },
            data: { outlierCount: stats.outlierCount, outlierRatio: stats.outlierRatio },
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

    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (err) {
    return handleRouteError(err);
  }
}
