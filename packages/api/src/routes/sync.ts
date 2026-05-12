// PR 3 — Sync push/pull API (integration-plan §6.1).
//
// 라우트 (모두 authMiddleware 통과):
//   POST   /api/sync/devices                 자기 device 등록·갱신 (cli sync push 첫 호출 시)
//   GET    /api/sync/devices                 자기 device 목록
//   POST   /api/sync/snapshots               manifest 업로드 (cli sync push)
//   POST   /api/sync/snapshots/:id/bundle    bundle zip 업로드 (multipart 또는 octet-stream)
//   GET    /api/sync/snapshots               device 별 최근 스냅샷 목록 (web)
//   GET    /api/sync/snapshots/:id           특정 스냅샷 메타 + manifest
//   GET    /api/sync/snapshots/:id/bundle    bundle 다운로드 (cli sync pull)
//   POST   /api/sync/jobs                    "복사 실행" — web 에서 호출
//   GET    /api/sync/jobs                    job 목록 (web=org, cli=자기 device target)
//   GET    /api/sync/jobs/:id                job 상세 (cli 가 적용에 필요한 정보 포함)
//   POST   /api/sync/jobs/:id/result         cli 가 적용 결과 보고

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  CreateJobSchema,
  CreateSnapshotSchema,
  RegisterDeviceSchema,
  ReportJobResultSchema,
  type SnapshotSummary,
  type SyncJobSummary,
} from "@mytool/shared";
import { prisma } from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { forbidden, notFound, unauthorized, validationError } from "../lib/errors.js";
import { getBundleStorage } from "../lib/storage.js";

export const syncRoute = new Hono();
syncRoute.use("*", authMiddleware);

// ──────────────────────────────────────────────────────────────
// 헬퍼
// ──────────────────────────────────────────────────────────────

async function requireOrgMembership(userId: string, orgId: string) {
  const m = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId } },
  });
  if (!m) throw forbidden("Not a member of this organization");
  return m;
}

/** sync push/pull 라우트는 토큰의 deviceId 가 필수. 기존 device 미연결 토큰은 거부. */
function requireDeviceFromToken(c: import("hono").Context): string {
  const id = c.get("tokenDeviceId");
  if (!id) {
    throw forbidden(
      "This token is not bound to a device. Run `mytool sync push` to register one.",
    );
  }
  return id;
}

function deviceJson(d: {
  id: string;
  name: string;
  hostname: string;
  platform: string;
  lastSeenAt: Date;
  createdAt: Date;
}) {
  return {
    id: d.id,
    name: d.name,
    hostname: d.hostname,
    platform: d.platform,
    lastSeenAt: d.lastSeenAt.toISOString(),
    createdAt: d.createdAt.toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────
// Device 등록·조회
// ──────────────────────────────────────────────────────────────

/**
 * POST /api/sync/devices — cli 첫 sync 시 호출.
 * 토큰에 deviceId 가 없으면 새 device 만들고 토큰과 묶음.
 * 이미 묶여 있으면 hostname/platform 만 갱신하고 lastSeenAt touch.
 */
syncRoute.post(
  "/devices",
  zValidator("json", RegisterDeviceSchema),
  async (c) => {
    const userId = c.get("userId");
    const tokenHash = c.get("tokenHash");
    const existingDeviceId = c.get("tokenDeviceId");
    const body = c.req.valid("json");

    const desiredName = (body.name ?? body.hostname).trim() || body.hostname;

    if (existingDeviceId) {
      // 갱신
      const updated = await prisma.device.update({
        where: { id: existingDeviceId },
        data: {
          hostname: body.hostname,
          platform: body.platform,
          lastSeenAt: new Date(),
        },
      });
      return c.json(deviceJson(updated));
    }

    // 같은 user 안에서 동일 name 의 device 가 이미 있으면 그걸 재사용 (다른 토큰에 묶여 있어도).
    const existingByName = await prisma.device.findUnique({
      where: { userId_name: { userId, name: desiredName } },
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
          userId,
          name: desiredName,
          hostname: body.hostname,
          platform: body.platform,
        },
      });
    }

    await prisma.cliToken.update({
      where: { tokenHash },
      data: { deviceId: device.id },
    });

    return c.json(deviceJson(device), 201);
  },
);

/** GET /api/sync/devices — 자기 device 목록 (web 의 1열). */
syncRoute.get("/devices", async (c) => {
  const userId = c.get("userId");
  const devices = await prisma.device.findMany({
    where: { userId },
    orderBy: { lastSeenAt: "desc" },
  });
  return c.json(devices.map(deviceJson));
});

// ──────────────────────────────────────────────────────────────
// Snapshot
// ──────────────────────────────────────────────────────────────

/** POST /api/sync/snapshots — cli 가 manifest 업로드. bundle 은 별도 라우트. */
syncRoute.post(
  "/snapshots",
  zValidator("json", CreateSnapshotSchema),
  async (c) => {
    const userId = c.get("userId");
    const deviceId = requireDeviceFromToken(c);
    const { orgId, manifest } = c.req.valid("json");

    await requireOrgMembership(userId, orgId);
    // device 가 진짜 이 user 의 것인지 한 번 더 검증 (토큰 손상 시 방어).
    const device = await prisma.device.findFirst({
      where: { id: deviceId, userId },
    });
    if (!device) throw forbidden("Token's device does not belong to this user");

    const snapshot = await prisma.syncSnapshot.create({
      data: {
        orgId,
        deviceId,
        createdBy: userId,
        manifest: manifest as object,
        masked: manifest.masked ?? false,
        itemCount: manifest.items.length,
      },
    });

    return c.json(
      {
        id: snapshot.id,
        orgId: snapshot.orgId,
        deviceId: snapshot.deviceId,
        createdAt: snapshot.createdAt.toISOString(),
      },
      201,
    );
  },
);

/**
 * POST /api/sync/snapshots/:id/bundle — bundle zip 업로드.
 * Content-Type: application/zip 으로 raw body 를 받는다 (multipart 보다 단순).
 */
syncRoute.post("/snapshots/:id/bundle", async (c) => {
  const userId = c.get("userId");
  const deviceId = requireDeviceFromToken(c);
  const id = c.req.param("id");

  const snapshot = await prisma.syncSnapshot.findUnique({
    where: { id },
  });
  if (!snapshot) throw notFound("Snapshot not found");
  if (snapshot.deviceId !== deviceId) {
    throw forbidden("This snapshot belongs to another device");
  }
  await requireOrgMembership(userId, snapshot.orgId);

  // 5MB soft limit (integration-plan §11). 더 크면 일단 수락하되 응답에 경고.
  const arr = await c.req.arrayBuffer();
  const buf = Buffer.from(arr);
  if (buf.byteLength === 0) {
    throw validationError("empty body");
  }

  const storage = getBundleStorage();
  await storage.put(snapshot.id, buf);

  await prisma.syncSnapshot.update({
    where: { id: snapshot.id },
    data: { bundleStorageKey: snapshot.id },
  });

  return c.json({ ok: true, size: buf.byteLength });
});

/** GET /api/sync/snapshots — web 1열용. user 의 device 들의 최근 스냅샷. */
syncRoute.get("/snapshots", async (c) => {
  const userId = c.get("userId");
  const myDeviceIds = (
    await prisma.device.findMany({ where: { userId }, select: { id: true } })
  ).map((d) => d.id);

  if (myDeviceIds.length === 0) return c.json([]);

  const snapshots = await prisma.syncSnapshot.findMany({
    where: { deviceId: { in: myDeviceIds } },
    orderBy: { createdAt: "desc" },
    include: { device: true },
    take: 200,
  });

  const out: SnapshotSummary[] = snapshots.map((s) => ({
    id: s.id,
    orgId: s.orgId,
    deviceId: s.deviceId,
    device: deviceJson(s.device),
    createdBy: s.createdBy,
    createdAt: s.createdAt.toISOString(),
    hasBundle: !!s.bundleStorageKey,
    masked: s.masked,
    itemCount: s.itemCount,
  }));
  return c.json(out);
});

/** GET /api/sync/snapshots/:id — manifest 포함 상세. */
syncRoute.get("/snapshots/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const snapshot = await prisma.syncSnapshot.findUnique({
    where: { id },
    include: { device: true },
  });
  if (!snapshot) throw notFound("Snapshot not found");

  // user 가 device 의 owner 거나, 같은 org 의 멤버일 때 허용.
  // (현재는 한 user = 한 org 가정이 강하지만, 멀티-org 대비)
  const ownsDevice = snapshot.device.userId === userId;
  if (!ownsDevice) {
    await requireOrgMembership(userId, snapshot.orgId);
  }

  return c.json({
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
});

/**
 * GET /api/sync/snapshots/:id/bundle — bundle 다운로드.
 * - supabase 백엔드: 302 redirect to signed URL
 * - local 백엔드: 직접 stream 응답
 */
syncRoute.get("/snapshots/:id/bundle", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const snapshot = await prisma.syncSnapshot.findUnique({
    where: { id },
    include: { device: true },
  });
  if (!snapshot) throw notFound("Snapshot not found");
  if (!snapshot.bundleStorageKey) throw notFound("Bundle not yet uploaded");

  const ownsDevice = snapshot.device.userId === userId;
  if (!ownsDevice) {
    await requireOrgMembership(userId, snapshot.orgId);
  }

  const storage = getBundleStorage();
  const signed = await storage.getSignedUrl(snapshot.bundleStorageKey);
  if (signed) {
    return c.redirect(signed, 302);
  }
  // local 백엔드 — 직접 stream
  const stream = await storage.read(snapshot.bundleStorageKey);
  c.header("Content-Type", "application/zip");
  c.header(
    "Content-Disposition",
    `attachment; filename="${snapshot.id}.zip"`,
  );
  return c.body(stream as never);
});

// ──────────────────────────────────────────────────────────────
// Job
// ──────────────────────────────────────────────────────────────

function jobJson(j: {
  id: string;
  orgId: string;
  sourceSnapshotId: string;
  targetDeviceId: string;
  targetProjectId: string | null;
  itemIds: unknown;
  options: unknown;
  status: string;
  result: unknown;
  createdBy: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}): SyncJobSummary {
  return {
    id: j.id,
    orgId: j.orgId,
    sourceSnapshotId: j.sourceSnapshotId,
    targetDeviceId: j.targetDeviceId,
    targetProjectId: j.targetProjectId,
    itemIds: (Array.isArray(j.itemIds) ? j.itemIds : []) as string[],
    options: (j.options ?? { mask: false, overwrite: "backup" }) as SyncJobSummary["options"],
    status: j.status as SyncJobSummary["status"],
    result: (j.result ?? null) as SyncJobSummary["result"],
    createdBy: j.createdBy,
    createdAt: j.createdAt.toISOString(),
    startedAt: j.startedAt ? j.startedAt.toISOString() : null,
    finishedAt: j.finishedAt ? j.finishedAt.toISOString() : null,
  };
}

/** POST /api/sync/jobs — web 의 "복사 실행". */
syncRoute.post("/jobs", zValidator("json", CreateJobSchema), async (c) => {
  const userId = c.get("userId");
  const body = c.req.valid("json");

  const snapshot = await prisma.syncSnapshot.findUnique({
    where: { id: body.sourceSnapshotId },
    include: { device: true },
  });
  if (!snapshot) throw notFound("Source snapshot not found");
  if (!snapshot.bundleStorageKey) {
    throw validationError("Source snapshot has no bundle yet");
  }

  // 권한: snapshot 의 orgId 가 user 의 org 여야 한다.
  await requireOrgMembership(userId, snapshot.orgId);

  // target device 도 같은 user 소속이어야 한다 (다른 user 의 PC 에 임의 push 금지).
  const targetDevice = await prisma.device.findFirst({
    where: { id: body.targetDeviceId, userId },
  });
  if (!targetDevice) {
    throw forbidden("Target device does not belong to this user");
  }

  // targetProjectId 가 있으면 같은 org 인지.
  if (body.targetProjectId) {
    const project = await prisma.project.findUnique({
      where: { id: body.targetProjectId },
      select: { orgId: true },
    });
    if (!project || project.orgId !== snapshot.orgId) {
      throw validationError("targetProjectId is not in the same org");
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
      createdBy: userId,
    },
  });

  return c.json(jobJson(job), 201);
});

/**
 * GET /api/sync/jobs?deviceId=...&status=pending — cli 폴링 + web 목록.
 * - deviceId 미지정: 자기 user 의 모든 device 의 inbound job 반환 (web 패널)
 * - deviceId 지정: 그 device 가 자기 user 소속이어야 함
 * - status 필터 옵션
 */
syncRoute.get("/jobs", async (c) => {
  const userId = c.get("userId");
  const deviceIdParam = c.req.query("deviceId");
  const statusParam = c.req.query("status");

  const myDeviceIds = (
    await prisma.device.findMany({ where: { userId }, select: { id: true } })
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

  if (targetDeviceIds.length === 0) return c.json([]);

  const jobs = await prisma.syncJob.findMany({
    where: {
      targetDeviceId: { in: targetDeviceIds },
      ...(statusParam ? { status: statusParam } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return c.json(jobs.map(jobJson));
});

/**
 * GET /api/sync/jobs/:id — cli 가 적용에 필요한 모든 정보.
 * 응답은 SyncJobWork — bundleUrl 과 manifest 를 포함.
 *
 * 토큰의 deviceId 가 job.targetDeviceId 와 일치해야 한다 (다른 PC 의 job 못 봄).
 */
syncRoute.get("/jobs/:id", async (c) => {
  const userId = c.get("userId");
  const tokenDeviceId = c.get("tokenDeviceId");
  const id = c.req.param("id");

  const job = await prisma.syncJob.findUnique({
    where: { id },
    include: { snapshot: { include: { device: true } } },
  });
  if (!job) throw notFound("Job not found");

  // web 과 cli 둘 다 이 라우트 사용. cli (token 에 deviceId) 면 target 일치 검사.
  if (tokenDeviceId) {
    if (tokenDeviceId !== job.targetDeviceId) {
      throw forbidden("Token's device is not the target of this job");
    }
  } else {
    // web 호출 — 같은 user 소속인지만 확인
    if (job.snapshot.device.userId !== userId) {
      const target = await prisma.device.findFirst({
        where: { id: job.targetDeviceId, userId },
      });
      if (!target) throw forbidden("Job is not yours");
    }
  }
  await requireOrgMembership(userId, job.orgId);

  if (!job.snapshot.bundleStorageKey) {
    throw validationError("Source snapshot has no bundle yet");
  }
  const storage = getBundleStorage();
  const signed = await storage.getSignedUrl(job.snapshot.bundleStorageKey);
  // local 백엔드는 signed=null → cli 가 우리 라우트로 직접 받아야 함.
  // 절대 URL 이 필요한 곳을 위해 우리 도메인 + 라우트로 셋팅.
  const baseUrl = new URL(c.req.url).origin;
  const bundleUrl =
    signed ?? `${baseUrl}/api/sync/snapshots/${job.snapshot.id}/bundle`;

  return c.json({
    ...jobJson(job),
    bundleUrl,
    manifest: job.snapshot.manifest,
  });
});

/** POST /api/sync/jobs/:id/result — cli 가 적용 결과 보고. */
syncRoute.post(
  "/jobs/:id/result",
  zValidator("json", ReportJobResultSchema),
  async (c) => {
    const tokenDeviceId = c.get("tokenDeviceId");
    if (!tokenDeviceId) {
      throw unauthorized("Result reports require a device-bound token");
    }
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const job = await prisma.syncJob.findUnique({ where: { id } });
    if (!job) throw notFound("Job not found");
    if (job.targetDeviceId !== tokenDeviceId) {
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
    return c.json(jobJson(updated));
  },
);
