import { NextResponse } from "next/server";
import { HarnessEventInputSchema, type HarnessRunStatus } from "@mytool/shared";
import { prisma } from "@/lib/db";
import {
  badRequest,
  gone,
  handleRouteError,
  notFound,
  unauthorized,
} from "@/lib/api-errors";
import { harnessBroker } from "@/lib/harness-broker";
import {
  eventSummary,
  hashReportToken,
  statusFromEvent,
} from "@/lib/harness-api";

interface RouteContext {
  params: Promise<{ runId: string }>;
}

/**
 * POST /api/harness/runs/:runId/events
 *
 * 인증: Bearer = run 의 reportToken (평문). user 세션 토큰과 분리.
 * harness CLI 의 HttpReporter.emit() 이 호출하는 라우트.
 */
export async function POST(
  req: Request,
  ctx: RouteContext,
): Promise<NextResponse> {
  try {
    const { runId } = await ctx.params;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw unauthorized("Missing Bearer token");
    }
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) throw unauthorized("Empty token");

    const tokenHash = hashReportToken(token);
    const run = await prisma.harnessRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        reportTokenHash: true,
        reportTokenExpiresAt: true,
        status: true,
      },
    });
    if (!run) throw notFound("Run not found");
    if (run.reportTokenHash !== tokenHash) {
      throw unauthorized("Invalid report token");
    }
    if (run.reportTokenExpiresAt < new Date()) {
      throw unauthorized("Report token has expired");
    }
    if (run.status === "aborted") {
      throw gone("Run was aborted");
    }

    let body;
    try {
      body = HarnessEventInputSchema.parse(await req.json());
    } catch (err) {
      throw badRequest(
        "Validation failed",
        (err as { flatten?: () => unknown }).flatten?.(),
      );
    }

    let ts: Date;
    try {
      ts = new Date(body.ts);
      if (Number.isNaN(ts.getTime())) throw new Error("invalid ts");
    } catch {
      throw badRequest("ts must be ISO-8601 datetime");
    }

    const event = await prisma.harnessEvent.create({
      data: {
        runId,
        ts,
        phase: body.phase,
        level: body.level,
        payload: body.payload as object,
      },
    });

    const nextStatus: HarnessRunStatus | null = statusFromEvent(
      body.phase,
      body.payload,
    );
    const incrementIteration =
      body.phase === "build" &&
      (body.payload as Record<string, unknown>).stage === "start";

    if (nextStatus || incrementIteration) {
      const updated = await prisma.harnessRun.update({
        where: { id: runId },
        data: {
          ...(incrementIteration ? { iterations: { increment: 1 } } : {}),
          ...(nextStatus
            ? { status: nextStatus, finishedAt: new Date() }
            : {}),
        },
      });
      if (nextStatus) {
        harnessBroker.publish(runId, {
          kind: "status",
          status: nextStatus,
          finishedAt: updated.finishedAt
            ? updated.finishedAt.toISOString()
            : null,
        });
      }
    }

    harnessBroker.publish(runId, {
      kind: "event",
      event: eventSummary(event),
    });

    return NextResponse.json({ ok: true, id: event.id });
  } catch (err) {
    return handleRouteError(err);
  }
}
