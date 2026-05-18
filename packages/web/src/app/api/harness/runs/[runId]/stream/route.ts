import type { HarnessRunStatus, HarnessStreamFrame } from "@mytool/shared";
import { prisma } from "@/lib/db";
import { requireAuthAny } from "@/lib/api-auth";
import { handleRouteError, notFound } from "@/lib/api-errors";
import { harnessBroker } from "@/lib/harness-broker";
import {
  eventSummary,
  requireOrgMembership,
  runSummary,
} from "@/lib/harness-api";

interface RouteContext {
  params: Promise<{ runId: string }>;
}

// Vercel 의 기본 serverless 는 응답 max-duration 이 짧다. SSE 는 keep-alive 가
// 핵심이므로 Node.js runtime + maxDuration 명시. (단, 무한 streaming 은 여전히
// Vercel 의 한계 — 장기 stream 은 PR 11 daemon WebSocket 으로 승격될 것.)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5분. final status 가 빨리 오면 그 전에 close.

/**
 * GET /api/harness/runs/:runId/stream — SSE.
 *
 * 흐름:
 *   1) 인증·권한
 *   2) broker.subscribe(runId, ...) 먼저 등록 (race 방지)
 *   3) DB 의 기존 events 를 snapshot frame 으로 한 번에 push
 *   4) 이후 broker 가 publish 하는 live frame 을 그대로 전송
 *   5) 30초마다 ping frame
 *   6) run 이 final 이면 status frame 보낸 뒤 stream close
 */
export async function GET(
  req: Request,
  ctx: RouteContext,
): Promise<Response> {
  try {
    const auth = await requireAuthAny(req);
    const { runId } = await ctx.params;

    const run = await prisma.harnessRun.findUnique({
      where: { id: runId },
      include: { project: { select: { orgId: true } } },
    });
    if (!run) throw notFound("Run not found");
    await requireOrgMembership(auth.userId, run.project.orgId);

    // closure 로 cleanup 잡기.
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

        const unsubscribe = harnessBroker.subscribe(runId, send);

        const existing = await prisma.harnessEvent.findMany({
          where: { runId },
          orderBy: { ts: "asc" },
        });
        send({
          kind: "snapshot",
          run: runSummary(run),
          events: existing.map(eventSummary),
        });

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
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
