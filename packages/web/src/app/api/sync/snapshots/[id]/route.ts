import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthAny } from "@/lib/api-auth";
import { handleRouteError, notFound } from "@/lib/api-errors";
import { deviceJson, requireOrgMembership } from "@/lib/sync-api";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** GET /api/sync/snapshots/:id — manifest 포함 상세. */
export async function GET(req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const auth = await requireAuthAny(req);
    const { id } = await ctx.params;

    const snapshot = await prisma.syncSnapshot.findUnique({
      where: { id },
      include: { device: true },
    });
    if (!snapshot) throw notFound("Snapshot not found");

    const ownsDevice = snapshot.device.userId === auth.userId;
    if (!ownsDevice) {
      await requireOrgMembership(auth.userId, snapshot.orgId);
    }

    return NextResponse.json({
      id: snapshot.id,
      orgId: snapshot.orgId,
      deviceId: snapshot.deviceId,
      device: deviceJson(snapshot.device),
      createdBy: snapshot.createdBy,
      createdAt: snapshot.createdAt.toISOString(),
      hasBundle: !!snapshot.bundleStorageKey,
      masked: snapshot.masked,
      itemCount: snapshot.itemCount,
      manifest: snapshot.manifest,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
