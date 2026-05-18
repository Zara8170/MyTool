import { NextResponse } from "next/server";
import type { HarnessRunDetail } from "@mytool/shared";
import { prisma } from "@/lib/db";
import { requireAuthAny } from "@/lib/api-auth";
import { handleRouteError, notFound } from "@/lib/api-errors";
import {
  eventSummary,
  requireOrgMembership,
  runSummary,
} from "@/lib/harness-api";

interface RouteContext {
  params: Promise<{ runId: string }>;
}

/** GET /api/harness/runs/:runId — run 상세 + 모든 events (page 진입용). */
export async function GET(
  req: Request,
  ctx: RouteContext,
): Promise<NextResponse> {
  try {
    const auth = await requireAuthAny(req);
    const { runId } = await ctx.params;

    const run = await prisma.harnessRun.findUnique({
      where: { id: runId },
      include: { project: { select: { orgId: true } } },
    });
    if (!run) throw notFound("Run not found");
    await requireOrgMembership(auth.userId, run.project.orgId);

    const events = await prisma.harnessEvent.findMany({
      where: { runId },
      orderBy: { ts: "asc" },
    });

    const detail: HarnessRunDetail = {
      ...runSummary(run),
      configSnapshot: run.configSnapshot ?? null,
      events: events.map(eventSummary),
      eventCount: events.length,
    };
    return NextResponse.json(detail);
  } catch (err) {
    return handleRouteError(err);
  }
}
