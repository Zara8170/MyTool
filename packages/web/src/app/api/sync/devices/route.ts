import { NextResponse } from "next/server";
import { RegisterDeviceSchema } from "@mytool/shared";
import { prisma } from "@/lib/db";
import { requireAuthAny } from "@/lib/api-auth";
import { handleRouteError, badRequest } from "@/lib/api-errors";
import { deviceJson } from "@/lib/sync-api";

/**
 * POST /api/sync/devices — cli `sync push` 첫 실행 시 device 등록·갱신.
 * 토큰에 deviceId 가 없으면 새로 만들고 토큰에 묶음. 이미 묶여 있으면 갱신.
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const auth = await requireAuthAny(req);
    let body;
    try {
      body = RegisterDeviceSchema.parse(await req.json());
    } catch (err) {
      throw badRequest("Validation failed", (err as { flatten?: () => unknown }).flatten?.());
    }

    const desiredName = (body.name ?? body.hostname).trim() || body.hostname;

    if (auth.tokenDeviceId) {
      const updated = await prisma.device.update({
        where: { id: auth.tokenDeviceId },
        data: {
          hostname: body.hostname,
          platform: body.platform,
          lastSeenAt: new Date(),
        },
      });
      return NextResponse.json(deviceJson(updated));
    }

    const existingByName = await prisma.device.findUnique({
      where: { userId_name: { userId: auth.userId, name: desiredName } },
    });

    let device;
    if (existingByName) {
      device = await prisma.device.update({
        where: { id: existingByName.id },
        data: {
          hostname: body.hostname,
          platform: body.platform,
          lastSeenAt: new Date(),
        },
      });
    } else {
      device = await prisma.device.create({
        data: {
          userId: auth.userId,
          name: desiredName,
          hostname: body.hostname,
          platform: body.platform,
        },
      });
    }

    await prisma.cliToken.update({
      where: { tokenHash: auth.tokenHash },
      data: { deviceId: device.id },
    });

    return NextResponse.json(deviceJson(device), { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** GET /api/sync/devices — 자기 device 목록. */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const auth = await requireAuthAny(req);
    const devices = await prisma.device.findMany({
      where: { userId: auth.userId },
      orderBy: { lastSeenAt: "desc" },
    });
    return NextResponse.json(devices.map(deviceJson));
  } catch (err) {
    return handleRouteError(err);
  }
}
