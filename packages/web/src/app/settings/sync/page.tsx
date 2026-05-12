// PR 3 — /settings/sync 4열 페이지 (integration-plan §7.1).
//
// Server component 가 토큰 검증 + 초기 데이터 (devices, snapshots, jobs, projects, skill 호출 통계) 를 페치하고
// SyncDashboard 클라이언트 컴포넌트에 props 로 넘긴다. 클라이언트는 jobs 패널만 5초 폴링.

import { redirect } from "next/navigation";
import Link from "next/link";

import { getAuthToken } from "@/lib/auth";
import { verifyJwt } from "@/lib/jwt";
import { prisma } from "@/lib/db";
import { snapshotSummaryJson, deviceJson, jobJson } from "@/lib/sync-api";

import { SyncDashboard } from "@/components/sync/sync-dashboard";

export const dynamic = "force-dynamic";

export default async function SyncSettingsPage() {
  const token = await getAuthToken();
  if (!token) redirect("/login");
  let userId: string;
  try {
    userId = (await verifyJwt(token)).sub;
  } catch {
    redirect("/login");
  }

  // 1) devices
  const devicesRaw = await prisma.device.findMany({
    where: { userId },
    orderBy: { lastSeenAt: "desc" },
  });
  const devices = devicesRaw.map(deviceJson);

  // 2) snapshots
  const myDeviceIds = devicesRaw.map((d) => d.id);
  const snapshotsRaw = myDeviceIds.length
    ? await prisma.syncSnapshot.findMany({
        where: { deviceId: { in: myDeviceIds } },
        orderBy: { createdAt: "desc" },
        include: { device: true },
        take: 200,
      })
    : [];
  const snapshots = snapshotsRaw.map(snapshotSummaryJson);

  // 3) projects (target 후보)
  const memberships = await prisma.orgMembership.findMany({
    where: { userId },
    include: { org: { include: { projects: true } } },
  });
  const projects = memberships
    .flatMap((m) => m.org.projects.map((p) => ({ ...p, orgName: m.org.name })))
    .map((p) => ({
      id: p.id,
      orgId: p.orgId,
      orgName: p.orgName,
      name: p.name,
      slug: p.slug,
    }));

  // 4) jobs (초기)
  const jobsRaw = myDeviceIds.length
    ? await prisma.syncJob.findMany({
        where: { targetDeviceId: { in: myDeviceIds } },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    : [];
  const jobs = jobsRaw.map(jobJson);

  // 5) skill 호출 통계 (UsageRecord 가 아니라 Event 의 skillName) — 최근 30일
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const skillCounts = await prisma.event.groupBy({
    by: ["skillName"],
    where: {
      userId,
      isSkillCall: true,
      timestamp: { gte: since },
      skillName: { not: null },
    },
    _count: { _all: true },
  });
  const skillUsage: Record<string, number> = {};
  for (const row of skillCounts) {
    if (row.skillName) skillUsage[row.skillName] = row._count._all;
  }

  return (
    <main className="max-w-7xl mx-auto p-8 space-y-6">
      <header className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Sync</h1>
          <p className="text-muted text-sm">
            Copy Claude Code skills and settings between your devices.
          </p>
        </div>
        <Link href="/settings" className="text-sm text-muted hover:text-text">
          ← Settings
        </Link>
      </header>

      <SyncDashboard
        devices={devices}
        snapshots={snapshots}
        projects={projects}
        initialJobs={jobs}
        skillUsage={skillUsage}
      />
    </main>
  );
}
