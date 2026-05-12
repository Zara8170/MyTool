import { NextResponse } from "next/server";
import { CreateJobSchema } from "@mytool/shared";
import { prisma } from "@/lib/db";
import { requireAuthAny } from "@/lib/api-auth";
import {
  handleRouteError,
  badRequest,
  forbidden,
  notFound,
} from "@/lib/api-errors";
import { jobJson, requireOrgMembership } from "@/lib/sync-api";

/**
 * POST /api/sync/jobs — web 의 "복사 실행".
 * sourceSnapshotId / targetDeviceId / itemIds 를 받아 SyncJob 을 만든다.
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const auth = await requireAuthAny(req);
    let body;
    try {
      body = CreateJobSchema.parse(await req.json());
    } catch (err) {
      throw badRequest("Validation failed", (err as { flatten?: () => unknown }).flatten?.());
    }

    const snapshot = await prisma.syncSnapshot.findUnique({
      where: { id: body.sourceSnapshotId },
      include: { device: true },
    });
    if (!snapshot) throw notFound("Source snapshot not found");
    if (!snapshot.bundleStorageKey) {
      throw badRequest("Source snapshot has no bundle yet");
    }

    await requireOrgMembership(auth.userId, snapshot.orgId);

    const targetDevice = await prisma.device.findFirst({
      where: { id: body.targetDeviceId, userId: auth.userId },
    });
    if (!targetDevice) {
      throw forbidden("Target device does not belong to this user");
    }

    if (body.targetProjectId) {
      const project = await prisma.project.findUnique({
        where: { id: body.targetProjectId },
        select: { orgId: true },
      });
      if (!project || project.orgId !== snapshot.orgId) {
        throw badRequest("targetProjectId is not in the same org");
      }
    }

    const job = await prisma.syncJob.create({
      data: {
        orgId: snapshot.orgId,
        sourceSnapshotId: snapshot.id,
        targetDeviceId: targetDevice.id,
        targetProjectId: body.targetProjectId ?? null,
        itemIds: body.itemIds as object,
        options: body.options as object,
        status: "pending",
        createdBy: auth.userId,
      },
    });

    return NextResponse.json(jobJson(job), { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** GET /api/sync/jobs?deviceId=...&status=pending — cli 폴링 + web 목록. */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const auth = await requireAuthAny(req);
    const url = new URL(req.url);
    const deviceIdParam = url.searchParams.get("deviceId");
    const statusParam = url.searchParams.get("status");

    const myDeviceIds = (
      await prisma.device.findMany({
        where: { userId: auth.userId },
        select: { id: true },
      })
    ).map((d) => d.id);

    let targetDeviceIds: string[];
    if (deviceIdParam) {
      if (!myDeviceIds.includes(deviceIdParam)) {
        throw forbidden("That device does not belong to this user");
      }
      targetDeviceIds = [deviceIdParam];
    } else {
      targetDeviceIds = myDeviceIds;
    }

    if (targetDeviceIds.length === 0) return NextResponse.json([]);

    const jobs = await prisma.syncJob.findMany({
      where: {
        targetDeviceId: { in: targetDeviceIds },
        ...(statusParam ? { status: statusParam } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json(jobs.map(jobJson));
  } catch (err) {
    return handleRouteError(err);
  }
}
