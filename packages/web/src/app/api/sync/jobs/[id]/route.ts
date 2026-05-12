import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthAny } from "@/lib/api-auth";
import {
  handleRouteError,
  badRequest,
  forbidden,
  notFound,
} from "@/lib/api-errors";
import { getBundleStorage } from "@/lib/storage";
import { jobJson, requireOrgMembership } from "@/lib/sync-api";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/sync/jobs/:id — cli 가 적용에 필요한 정보 (bundleUrl, manifest 포함).
 */
export async function GET(req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const auth = await requireAuthAny(req);
    const { id } = await ctx.params;

    const job = await prisma.syncJob.findUnique({
      where: { id },
      include: { snapshot: { include: { device: true } } },
    });
    if (!job) throw notFound("Job not found");

    if (auth.tokenDeviceId) {
      if (auth.tokenDeviceId !== job.targetDeviceId) {
        throw forbidden("Token's device is not the target of this job");
      }
    } else {
      if (job.snapshot.device.userId !== auth.userId) {
        const target = await prisma.device.findFirst({
          where: { id: job.targetDeviceId, userId: auth.userId },
        });
        if (!target) throw forbidden("Job is not yours");
      }
    }
    await requireOrgMembership(auth.userId, job.orgId);

    if (!job.snapshot.bundleStorageKey) {
      throw badRequest("Source snapshot has no bundle yet");
    }
    const storage = getBundleStorage();
    const signed = await storage.getSignedUrl(job.snapshot.bundleStorageKey);
    const baseUrl = new URL(req.url).origin;
    const bundleUrl =
      signed ?? `${baseUrl}/api/sync/snapshots/${job.snapshot.id}/bundle`;

    return NextResponse.json({
      ...jobJson(job),
      bundleUrl,
      manifest: job.snapshot.manifest,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
