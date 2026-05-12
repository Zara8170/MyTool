// PR 3 — Sync API 헬퍼 (Next.js 라우트 공용).
// packages/api/src/routes/sync.ts 의 로직을 web 측에 거울처럼 옮긴다.
// Vercel 호스팅에서는 web 의 라우트가 cli 와 web 양쪽의 진입점.

import "server-only";
import { prisma } from "./db";
import { forbidden } from "./api-errors";
import type { SnapshotSummary, SyncJobSummary } from "@mytool/shared";

export async function requireOrgMembership(userId: string, orgId: string) {
  const m = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId } },
  });
  if (!m) throw forbidden("Not a member of this organization");
  return m;
}

/** sync push/pull 라우트는 토큰의 deviceId 가 필수. 기존 device 미연결 토큰은 거부. */
export function requireDeviceFromToken(tokenDeviceId: string | null): string {
  if (!tokenDeviceId) {
    throw forbidden(
      "This token is not bound to a device. Run `mytool sync push` to register one.",
    );
  }
  return tokenDeviceId;
}

export function deviceJson(d: {
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

export function snapshotSummaryJson(s: {
  id: string;
  orgId: string;
  deviceId: string;
  device: {
    id: string;
    name: string;
    hostname: string;
    platform: string;
    lastSeenAt: Date;
    createdAt: Date;
  };
  createdBy: string;
  createdAt: Date;
  bundleStorageKey: string | null;
  masked: boolean;
  itemCount: number;
}): SnapshotSummary {
  return {
    id: s.id,
    orgId: s.orgId,
    deviceId: s.deviceId,
    device: deviceJson(s.device),
    createdBy: s.createdBy,
    createdAt: s.createdAt.toISOString(),
    hasBundle: !!s.bundleStorageKey,
    masked: s.masked,
    itemCount: s.itemCount,
  };
}

export function jobJson(j: {
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
