import { NextResponse } from "next/server";
import { CreateSnapshotSchema } from "@mytool/shared";
import { prisma } from "@/lib/db";
import { requireAuthAny } from "@/lib/api-auth";
import { handleRouteError, badRequest, forbidden } from "@/lib/api-errors";
import {
  requireDeviceFromToken,
  requireOrgMembership,
  snapshotSummaryJson,
} from "@/lib/sync-api";

/** POST /api/sync/snapshots — cli 가 manifest 업로드. bundle 은 별도 라우트. */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const auth = await requireAuthAny(req);
    const deviceId = requireDeviceFromToken(auth.tokenDeviceId);

    let body;
    try {
      body = CreateSnapshotSchema.parse(await req.json());
    } catch (err) {
      throw badRequest("Validation failed", (err as { flatten?: () => unknown }).flatten?.());
    }
    const { orgId, manifest } = body;

    await requireOrgMembership(auth.userId, orgId);

    const device = await prisma.device.findFirst({
      where: { id: deviceId, userId: auth.userId },
    });
    if (!device) throw forbidden("Token's device does not belong to this user");

    const snapshot = await prisma.syncSnapshot.create({
      data: {
        orgId,
        deviceId,
        createdBy: auth.userId,
        manifest: manifest as object,
        masked: manifest.masked ?? false,
        itemCount: manifest.items.length,
      },
    });

    return NextResponse.json(
      {
        id: snapshot.id,
        orgId: snapshot.orgId,
        deviceId: snapshot.deviceId,
        createdAt: snapshot.createdAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}

/** GET /api/sync/snapshots — web 1열용. user 의 device 들의 최근 스냅샷. */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const auth = await requireAuthAny(req);
    const myDeviceIds = (
      await prisma.device.findMany({
        where: { userId: auth.userId },
        select: { id: true },
      })
    ).map((d) => d.id);
    if (myDeviceIds.length === 0) return NextResponse.json([]);

    const snapshots = await prisma.syncSnapshot.findMany({
      where: { deviceId: { in: myDeviceIds } },
      orderBy: { createdAt: "desc" },
      include: { device: true },
      take: 200,
    });
    return NextResponse.json(snapshots.map(snapshotSummaryJson));
  } catch (err) {
    return handleRouteError(err);
  }
}
