import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthAny } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-errors";
import { requireProjectAccess, runSummary } from "@/lib/harness-api";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

/** GET /api/projects/:projectId/harness/runs — 최근 run 목록. */
export async function GET(
  req: Request,
  ctx: RouteContext,
): Promise<NextResponse> {
  try {
    const auth = await requireAuthAny(req);
    const { projectId } = await ctx.params;
    await requireProjectAccess(auth.userId, projectId);

    const runs = await prisma.harnessRun.findMany({
      where: { projectId },
      orderBy: { startedAt: "desc" },
      take: 100,
    });
    return NextResponse.json(runs.map(runSummary));
  } catch (err) {
    return handleRouteError(err);
  }
}
