// PR 5 — Harness API 헬퍼 (Next.js 라우트 공용).
// packages/api/src/routes/harness.ts 의 로직을 web 측에 거울처럼 옮긴다.

import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";
import { forbidden, notFound } from "./api-errors";
import type {
  HarnessEventSummary,
  HarnessRunStatus,
  HarnessRunSummary,
} from "@mytool/shared";

export const REPORT_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24h

export function newReportToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

export function hashReportToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function requireOrgMembership(userId: string, orgId: string) {
  const m = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId } },
  });
  if (!m) throw forbidden("Not a member of this organization");
  return m;
}

export async function requireProjectAccess(userId: string, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, orgId: true, harnessEnabled: true },
  });
  if (!project) throw notFound("Project not found");
  await requireOrgMembership(userId, project.orgId);
  return project;
}

export function runSummary(r: {
  id: string;
  projectId: string;
  startedBy: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  iterations: number;
}): HarnessRunSummary {
  return {
    id: r.id,
    projectId: r.projectId,
    startedBy: r.startedBy,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    status: r.status as HarnessRunStatus,
    iterations: r.iterations,
  };
}

export function eventSummary(e: {
  id: string;
  runId: string;
  ts: Date;
  phase: string;
  level: string;
  payload: unknown;
  createdAt: Date;
}): HarnessEventSummary {
  return {
    id: e.id,
    runId: e.runId,
    ts: e.ts.toISOString(),
    phase: e.phase as HarnessEventSummary["phase"],
    level: e.level as HarnessEventSummary["level"],
    payload: (e.payload ?? {}) as Record<string, unknown>,
    createdAt: e.createdAt.toISOString(),
  };
}

/** report phase 의 outcome 에 따라 run status 결정. */
export function statusFromEvent(
  phase: string,
  payload: Record<string, unknown>,
): HarnessRunStatus | null {
  if (phase !== "report") return null;
  const outcome = payload?.outcome;
  if (outcome === "pass") return "passed";
  if (outcome === "fail") return "failed";
  return null;
}
