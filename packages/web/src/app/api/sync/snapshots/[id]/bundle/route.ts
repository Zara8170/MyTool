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
import { requireDeviceFromToken, requireOrgMembership } from "@/lib/sync-api";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/sync/snapshots/:id/bundle — bundle zip 업로드.
 * Content-Type: application/zip, raw body.
 */
export async function POST(req: Request, ctx: RouteContext): Promise<NextResponse> {
  try {
    const auth = await requireAuthAny(req);
    const deviceId = requireDeviceFromToken(auth.tokenDeviceId);
    const { id } = await ctx.params;

    const snapshot = await prisma.syncSnapshot.findUnique({ where: { id } });
    if (!snapshot) throw notFound("Snapshot not found");
    if (snapshot.deviceId !== deviceId) {
      throw forbidden("This snapshot belongs to another device");
    }
    await requireOrgMembership(auth.userId, snapshot.orgId);

    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.byteLength === 0) throw badRequest("empty body");

    const storage = getBundleStorage();
    await storage.put(snapshot.id, buf);

    await prisma.syncSnapshot.update({
      where: { id: snapshot.id },
      data: { bundleStorageKey: snapshot.id },
    });

    return NextResponse.json({ ok: true, size: buf.byteLength });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * GET /api/sync/snapshots/:id/bundle — bundle 다운로드.
 * - supabase: 302 redirect to signed URL
 * - local: 직접 stream
 */
export async function GET(req: Request, ctx: RouteContext): Promise<Response> {
  try {
    const auth = await requireAuthAny(req);
    const { id } = await ctx.params;
    const snapshot = await prisma.syncSnapshot.findUnique({
      where: { id },
      include: { device: true },
    });
    if (!snapshot) throw notFound("Snapshot not found");
    if (!snapshot.bundleStorageKey) throw notFound("Bundle not yet uploaded");

    const ownsDevice = snapshot.device.userId === auth.userId;
    if (!ownsDevice) {
      await requireOrgMembership(auth.userId, snapshot.orgId);
    }

    const storage = getBundleStorage();
    const signed = await storage.getSignedUrl(snapshot.bundleStorageKey);
    if (signed) {
      return NextResponse.redirect(signed, 302);
    }
    const stream = await storage.read(snapshot.bundleStorageKey);
    // Node Readable 을 Web ReadableStream 으로 — Next.js 가 이해할 수 있게.
    const { Readable } = await import("node:stream");
    const webStream = Readable.toWeb(stream as unknown as InstanceType<typeof Readable>) as ReadableStream;
    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${snapshot.id}.zip"`,
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
