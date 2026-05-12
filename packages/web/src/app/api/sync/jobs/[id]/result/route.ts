import { NextResponse } from "next/server";
import { ReportJobResultSchema } from "@mytool/shared";
import { prisma } from "@/lib/db";
import { requireAuthAny } from "@/lib/api-auth";
import {
  handleRouteError,
  badRequest,
  forbidden,
  notFound,
  unauthorized,
} from "@/lib/api-errors";
import { jobJson } from "@/lib/sync-api";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** POST /api/sync/jobs/:id/result — cli 가 적용 결과 보고. */
export async function POST(req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const auth = await requireAuthAny(req);
    if (!auth.tokenDeviceId) {
      throw unauthorized("Result reports require a device-bound token");
    }
    const { id } = await ctx.params;

    let body;
    try {
      body = ReportJobResultSchema.parse(await req.json());
    } catch (err) {
      throw badRequest("Validation failed", (err as { flatten?: () => unknown }).flatten?.());
    }

    const job = await prisma.syncJob.findUnique({ where: { id } });
    if (!job) throw notFound("Job not found");
    if (job.targetDeviceId !== auth.tokenDeviceId) {
      throw forbidden("Token's device is not the target of this job");
    }

    const updated = await prisma.syncJob.update({
      where: { id },
      data: {
        status: body.status,
        result: body.result as object,
        startedAt: job.startedAt ?? new Date(),
        finishedAt: new Date(),
      },
    });
    return NextResponse.json(jobJson(updated));
  } catch (err) {
    return handleRouteError(err);
  }
}
