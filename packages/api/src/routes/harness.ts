// PR 5 — Harness Run / Event API (integration-plan §6.2).
//
// 라우트:
//   POST /api/projects/:id/harness/start       run 생성, reportToken 발급
//   POST /api/harness/runs/:runId/events       harness CLI 가 phase 전이 보고 (Bearer = reportToken)
//   POST /api/harness/runs/:runId/abort        web 의 "중단" 버튼
//   GET  /api/projects/:id/harness/runs        run 목록 (web)
//   GET  /api/harness/runs/:runId              run 상세 + events
//   GET  /api/harness/runs/:runId/stream       SSE — 라이브 이벤트
//
// 인증 분리:
// - start / abort / list / detail / stream — authMiddleware (user 세션·cli 토큰)
// - events — reportToken (run 단위 short-lived, 평문 1회만 발급)
//
// 같은 Hono app 안에 두 라우트 그룹이 있어 prefix 별로 분리해서 export 한다.

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { createHash, randomBytes } from "node:crypto";
import {
  HarnessEventInputSchema,
  StartHarnessRunSchema,
  type HarnessEventSummary,
  type HarnessRunDetail,
  type HarnessRunStatus,
  type HarnessRunSummary,
  type HarnessStreamFrame,
} from "@mytool/shared";
import { prisma } from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { forbidden, gone, notFound, unauthorized, validationError } from "../lib/errors.js";
import { harnessBroker } from "../lib/harness-broker.js";

// ──────────────────────────────────────────────────────────────
// 헬퍼
// ──────────────────────────────────────────────────────────────

const REPORT_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24h

function newReportToken(): { token: string; hash: string } {
  // 32 byte = 256bit entropy. URL-safe base64. CLI 가 `--report-token` 으로 받음.
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

function hashReportToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function requireOrgMembership(userId: string, orgId: string) {
  const m = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId } },
  });
  if (!m) throw forbidden("Not a member of this organization");
  return m;
}

async function requireProjectAccess(userId: string, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, orgId: true, harnessEnabled: true },
  });
  if (!project) throw notFound("Project not found");
  await requireOrgMembership(userId, project.orgId);
  return project;
}

function runSummary(r: {
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

function eventSummary(e: {
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

/**
 * verify outcome 이 final 인 경우 (pass / fail) run.status 를 자동으로 업데이트.
 * harness 의 reporter 가 마지막 단계에 보내는 report phase event 의 payload.outcome 을 본다.
 */
function statusFromEvent(
  phase: string,
  payload: Record<string, unknown>,
): HarnessRunStatus | null {
  if (phase !== "report") return null;
  const outcome = payload?.outcome;
  if (outcome === "pass") return "passed";
  if (outcome === "fail") return "failed";
  return null;
}

// ──────────────────────────────────────────────────────────────
// 1) Project-scoped 라우트: start, runs list
// ──────────────────────────────────────────────────────────────

export const harnessProjectRoute = new Hono();
harnessProjectRoute.use("*", authMiddleware);

/**
 * POST /api/projects/:id/harness/start
 * - run 생성 + reportToken 발급 (평문은 응답 1회만)
 * - 응답: { runId, reportToken, reportUrl, expiresAt }
 * - 실제 subprocess spawn 은 호출자 (web) 가 결정 — 셀프호스팅이면 같은 호스트에서,
 *   SaaS 면 사용자 PC 의 cli 가 받아서 실행 (cli 가 daemon-like 로 시작).
 *   PR 5 에서는 reportToken 발급까지가 책임. spawn 은 PR 6 / PR 11 에서.
 */
harnessProjectRoute.post(
  "/:projectId/harness/start",
  zValidator("json", StartHarnessRunSchema),
  async (c) => {
    const userId = c.get("userId");
    const projectId = c.req.param("projectId");
    const body = c.req.valid("json");

    const project = await requireProjectAccess(userId, projectId);
    if (!project.harnessEnabled) {
      throw forbidden("Harness is not enabled for this project");
    }

    const { token, hash } = newReportToken();
    const expiresAt = new Date(Date.now() + REPORT_TOKEN_LIFETIME_MS);

    // Prisma 의 nullable Json 필드는 `null` 직접 대입 불가 — 필드 생략 (DB 기본값 NULL).
    // configSnapshot 이 주어진 경우만 데이터에 포함.
    const run = await prisma.harnessRun.create({
      data: {
        projectId,
        startedBy: userId,
        status: "running",
        reportTokenHash: hash,
        reportTokenExpiresAt: expiresAt,
        ...(body.configSnapshot !== undefined
          ? { configSnapshot: body.configSnapshot as object }
          : {}),
      },
    });

    const baseUrl = new URL(c.req.url).origin;
    return c.json(
      {
        runId: run.id,
        reportToken: token,
        reportUrl: `${baseUrl}/api/harness/runs/${run.id}/events`,
        expiresAt: expiresAt.toISOString(),
      },
      201,
    );
  },
);

/** GET /api/projects/:id/harness/runs — 최근 run 목록. */
harnessProjectRoute.get("/:projectId/harness/runs", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");
  await requireProjectAccess(userId, projectId);

  const runs = await prisma.harnessRun.findMany({
    where: { projectId },
    orderBy: { startedAt: "desc" },
    take: 100,
  });
  return c.json(runs.map(runSummary));
});

// ──────────────────────────────────────────────────────────────
// 2) Run-scoped 라우트: events (reportToken), abort, detail, stream
// ──────────────────────────────────────────────────────────────

export const harnessRunRoute = new Hono();

/**
 * POST /api/harness/runs/:runId/events
 *
 * 인증: Bearer = run 의 reportToken (평문). 일반 user 세션 토큰과 분리.
 * 이 라우트는 authMiddleware 를 거치지 않고 자체 토큰 검증.
 */
harnessRunRoute.post(
  "/:runId/events",
  zValidator("json", HarnessEventInputSchema),
  async (c) => {
    const runId = c.req.param("runId");
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw unauthorized("Missing Bearer token");
    }
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) throw unauthorized("Empty token");

    const tokenHash = hashReportToken(token);
    const run = await prisma.harnessRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        reportTokenHash: true,
        reportTokenExpiresAt: true,
        status: true,
        iterations: true,
      },
    });
    if (!run) throw notFound("Run not found");
    if (run.reportTokenHash !== tokenHash) {
      throw unauthorized("Invalid report token");
    }
    if (run.reportTokenExpiresAt < new Date()) {
      throw unauthorized("Report token has expired");
    }
    if (run.status === "aborted") {
      // 명시적 신호 — CLI 가 다음 emit 에서 멈출 수 있도록.
      throw gone("Run was aborted");
    }

    const body = c.req.valid("json");
    let ts: Date;
    try {
      ts = new Date(body.ts);
      if (Number.isNaN(ts.getTime())) throw new Error("invalid ts");
    } catch {
      throw validationError({ ts: "must be ISO-8601 datetime" });
    }

    const event = await prisma.harnessEvent.create({
      data: {
        runId,
        ts,
        phase: body.phase,
        level: body.level,
        payload: body.payload as object,
      },
    });

    // run 메타 업데이트:
    // - build 의 "stage: start" 일 때만 iterations++ (build 는 한 iter 당 start/done 2회 emit)
    // - report 의 outcome 에 따라 status 결정 + finishedAt
    const nextStatus: HarnessRunStatus | null = statusFromEvent(
      body.phase,
      body.payload,
    );
    const incrementIteration =
      body.phase === "build" &&
      (body.payload as Record<string, unknown>).stage === "start";

    if (nextStatus || incrementIteration) {
      const updated = await prisma.harnessRun.update({
        where: { id: runId },
        data: {
          ...(incrementIteration ? { iterations: { increment: 1 } } : {}),
          ...(nextStatus
            ? { status: nextStatus, finishedAt: new Date() }
            : {}),
        },
      });
      if (nextStatus) {
        harnessBroker.publish(runId, {
          kind: "status",
          status: nextStatus,
          finishedAt: updated.finishedAt
            ? updated.finishedAt.toISOString()
            : null,
        });
      }
    }

    harnessBroker.publish(runId, {
      kind: "event",
      event: eventSummary(event),
    });

    return c.json({ ok: true, id: event.id });
  },
);

/** POST /api/harness/runs/:runId/abort — user 가 중단. */
harnessRunRoute.post("/:runId/abort", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("runId");

  const run = await prisma.harnessRun.findUnique({
    where: { id: runId },
    include: { project: { select: { orgId: true } } },
  });
  if (!run) throw notFound("Run not found");
  await requireOrgMembership(userId, run.project.orgId);

  if (run.status !== "running") {
    return c.json(runSummary({ ...run }));
  }

  const updated = await prisma.harnessRun.update({
    where: { id: runId },
    data: { status: "aborted", finishedAt: new Date() },
  });
  harnessBroker.publish(runId, {
    kind: "status",
    status: "aborted",
    finishedAt: updated.finishedAt ? updated.finishedAt.toISOString() : null,
  });
  return c.json(runSummary(updated));
});

/** GET /api/harness/runs/:runId — run + 모든 events (page 진입용). */
harnessRunRoute.get("/:runId", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("runId");

  const run = await prisma.harnessRun.findUnique({
    where: { id: runId },
    include: { project: { select: { orgId: true } } },
  });
  if (!run) throw notFound("Run not found");
  await requireOrgMembership(userId, run.project.orgId);

  const events = await prisma.harnessEvent.findMany({
    where: { runId },
    orderBy: { ts: "asc" },
  });

  const detail: HarnessRunDetail = {
    ...runSummary(run),
    configSnapshot: run.configSnapshot ?? null,
    events: events.map(eventSummary),
    eventCount: events.length,
  };
  return c.json(detail);
});

/**
 * GET /api/harness/runs/:runId/stream — SSE.
 *
 * 흐름:
 *   1) 인증·권한 검사
 *   2) broker.subscribe(runId, ...) 먼저 등록 (race 방지)
 *   3) DB 의 기존 events 를 snapshot frame 으로 한 번에 push
 *   4) 이후 broker 가 publish 하는 live frame 을 그대로 전송
 *   5) 30초마다 ping frame
 *   6) run.status 가 final 이면 status frame 보낸 뒤 stream close
 */
harnessRunRoute.get("/:runId/stream", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("runId");

  const run = await prisma.harnessRun.findUnique({
    where: { id: runId },
    include: { project: { select: { orgId: true } } },
  });
  if (!run) throw notFound("Run not found");
  await requireOrgMembership(userId, run.project.orgId);

  // closure 로 cleanup 을 잡아두기 위해 outer 변수 사용.
  let cleanup: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (frame: HarnessStreamFrame) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(
              `event: ${frame.kind}\ndata: ${JSON.stringify(frame)}\n\n`,
            ),
          );
        } catch {
          closed = true;
        }
      };

      // 1) live 구독 먼저 (race 방지)
      const unsubscribe = harnessBroker.subscribe(runId, send);

      // 2) DB 에서 기존 events replay
      const existing = await prisma.harnessEvent.findMany({
        where: { runId },
        orderBy: { ts: "asc" },
      });
      send({
        kind: "snapshot",
        run: runSummary(run),
        events: existing.map(eventSummary),
      });

      // 이미 final 상태라면 status frame 한 번 더 보내고 종료
      if (run.status !== "running") {
        send({
          kind: "status",
          status: run.status as HarnessRunStatus,
          finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
        });
        setTimeout(() => {
          unsubscribe();
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }, 100);
        cleanup = () => {
          unsubscribe();
          closed = true;
        };
        return;
      }

      // 3) keep-alive ping (30초)
      const pingInterval = setInterval(() => {
        send({ kind: "ping", ts: new Date().toISOString() });
      }, 30_000);

      cleanup = () => {
        closed = true;
        clearInterval(pingInterval);
        unsubscribe();
      };
    },
    cancel() {
      // 클라이언트 disconnect / 서버 abort 시 호출.
      cleanup();
    },
  });

  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache, no-transform");
  c.header("Connection", "keep-alive");
  // 일부 프록시 (nginx) 가 SSE 를 버퍼링하지 않도록 명시
  c.header("X-Accel-Buffering", "no");
  return c.body(stream as never);
});
