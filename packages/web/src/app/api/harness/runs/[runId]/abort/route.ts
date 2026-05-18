import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthAny } from "@/lib/api-auth";
import { handleRouteError, notFound } from "@/lib/api-errors";
import { harnessBroker } from "@/lib/harness-broker";
import { requireOrgMembership, runSummary } from "@/lib/harness-api";

interface RouteContext {
  params: Promise<{ runId: string }>;
}

/** POST /api/harness/runs/:runId/abort — user 가 중단. */
export async function POST(
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

    if (run.status !== "running") {
      return NextResponse.json(runSummary(run));
    }

    const updated = await prisma.harnessRun.update({
      where: { id: runId },
      data: { status: "aborted", finishedAt: new Date() },
    });
    harnessBroker.publish(runId, {
      kind: "status",
      status: "aborted",
      finishedAt: updated.finishedAt
        ? updated.finishedAt.toISOString()
        : null,
    });
    return NextResponse.json(runSummary(updated));
  } catch (err) {
    return handleRouteError(err);
  }
}
