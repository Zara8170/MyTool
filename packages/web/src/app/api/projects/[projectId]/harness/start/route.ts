import { NextResponse } from "next/server";
import { StartHarnessRunSchema } from "@mytool/shared";
import { prisma } from "@/lib/db";
import { requireAuthAny } from "@/lib/api-auth";
import { badRequest, forbidden, handleRouteError } from "@/lib/api-errors";
import {
  REPORT_TOKEN_LIFETIME_MS,
  newReportToken,
  requireProjectAccess,
} from "@/lib/harness-api";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

/**
 * POST /api/projects/:projectId/harness/start — run 생성 + reportToken 발급.
 * 응답의 reportToken 평문은 1회만 노출.
 */
export async function POST(
  req: Request,
  ctx: RouteContext,
): Promise<NextResponse> {
  try {
    const auth = await requireAuthAny(req);
    const { projectId } = await ctx.params;

    let body;
    try {
      body = StartHarnessRunSchema.parse(await req.json());
    } catch (err) {
      throw badRequest(
        "Validation failed",
        (err as { flatten?: () => unknown }).flatten?.(),
      );
    }

    const project = await requireProjectAccess(auth.userId, projectId);
    if (!project.harnessEnabled) {
      throw forbidden("Harness is not enabled for this project");
    }

    const { token, hash } = newReportToken();
    const expiresAt = new Date(Date.now() + REPORT_TOKEN_LIFETIME_MS);

    // Prisma 의 nullable Json 필드는 `null` 직접 대입 불가 — 필드 생략 (DB 기본값 NULL).
    const run = await prisma.harnessRun.create({
      data: {
        projectId,
        startedBy: auth.userId,
        status: "running",
        reportTokenHash: hash,
        reportTokenExpiresAt: expiresAt,
        ...(body.configSnapshot !== undefined
          ? { configSnapshot: body.configSnapshot as object }
          : {}),
      },
    });

    const baseUrl = new URL(req.url).origin;
    return NextResponse.json(
      {
        runId: run.id,
        reportToken: token,
        reportUrl: `${baseUrl}/api/harness/runs/${run.id}/events`,
        expiresAt: expiresAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
