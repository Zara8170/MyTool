// PR 5 — Harness Run / Event 스키마 (integration-plan §5, §6.2).
//
// claude-harness 측 reporter.py 의 HTTP payload 와 1:1:
//   {
//     phase: "ideation" | "build" | "verify" | "report",
//     level: "info" | "warn" | "error",
//     ts:    "<ISO-8601 UTC>",
//     payload: { ... }
//   }
//
// 인증: harness CLI 는 run-scoped short-lived bearer 토큰 (HarnessRun.reportTokenHash)
// 으로 events 라우트 호출. web 측 인증 (Bearer cli-token 또는 mytool_token 쿠키) 과는 별개.

import { z } from "zod";

// ── Phase / Level / Status ────────────────────────────────────────────

export const HarnessPhaseSchema = z.enum([
  "ideation",
  "build",
  "verify",
  "report",
]);
export type HarnessPhase = z.infer<typeof HarnessPhaseSchema>;

export const HarnessLevelSchema = z.enum(["info", "warn", "error"]);
export type HarnessLevel = z.infer<typeof HarnessLevelSchema>;

export const HarnessRunStatusSchema = z.enum([
  "running",
  "passed",
  "failed",
  "aborted",
]);
export type HarnessRunStatus = z.infer<typeof HarnessRunStatusSchema>;

// ── Start Run ─────────────────────────────────────────────────────────

/**
 * POST /api/projects/:id/harness/start 의 body.
 * configSnapshot 은 사용자 PC 의 harness.yaml 를 그대로 파싱한 JSON.
 * web 의 yaml 편집기가 보낸다 (PR 6). CLI 직접 시작도 같은 라우트 사용 가능.
 */
export const StartHarnessRunSchema = z.object({
  /** harness.yaml 파싱 결과. 자유로운 schema — 검증은 harness 측에서. */
  configSnapshot: z.unknown().optional(),
});
export type StartHarnessRunRequest = z.infer<typeof StartHarnessRunSchema>;

/**
 * 응답 — reportToken 은 평문 1회만 노출. 이후로는 hash 만 DB 에 보관.
 * CLI 는 이 token 을 `--report-token` 으로 받아 events 라우트 인증에 사용.
 */
export const StartHarnessRunResponseSchema = z.object({
  runId: z.string(),
  reportToken: z.string(),
  /** events 라우트 절대 URL (CLI 의 --report-url 인자로 그대로 사용). */
  reportUrl: z.string(),
  expiresAt: z.string().datetime(),
});
export type StartHarnessRunResponse = z.infer<typeof StartHarnessRunResponseSchema>;

// ── Event (reporter → API) ────────────────────────────────────────────

/**
 * harness reporter.py 의 HttpReporter.emit() 가 보내는 body.
 * 키 이름·타입은 reporter.py 와 동일해야 함 — 변경 시 양쪽 같이 갱신.
 */
export const HarnessEventInputSchema = z.object({
  phase: HarnessPhaseSchema,
  level: HarnessLevelSchema.default("info"),
  /** reporter 가 생성한 ISO-8601 UTC timestamp. 서버 도착 시각과는 별개. */
  ts: z.string().datetime(),
  /**
   * phase-specific payload. 자유로운 dict.
   * 예: ideation → { selected: "req-001" }
   *     build    → { iteration: 0 }
   *     verify   → { outcome: "pass" | "fail" }
   *     report   → { outcome, rolled_back_to? }
   */
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type HarnessEventInput = z.infer<typeof HarnessEventInputSchema>;

// ── HarnessRun / HarnessEvent (API → web) ─────────────────────────────

export const HarnessEventSummarySchema = z.object({
  id: z.string(),
  runId: z.string(),
  ts: z.string().datetime(),
  phase: HarnessPhaseSchema,
  level: HarnessLevelSchema,
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type HarnessEventSummary = z.infer<typeof HarnessEventSummarySchema>;

export const HarnessRunSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  startedBy: z.string(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  status: HarnessRunStatusSchema,
  iterations: z.number().int().nonnegative(),
  /** events 배열 — list 응답에서는 제외, detail/stream 에서만 포함. */
  eventCount: z.number().int().nonnegative().optional(),
});
export type HarnessRunSummary = z.infer<typeof HarnessRunSummarySchema>;

export const HarnessRunDetailSchema = HarnessRunSummarySchema.extend({
  configSnapshot: z.unknown().nullable(),
  events: z.array(HarnessEventSummarySchema),
});
export type HarnessRunDetail = z.infer<typeof HarnessRunDetailSchema>;

// ── SSE message frame ─────────────────────────────────────────────────

/**
 * GET /api/harness/runs/:runId/stream 이 보내는 SSE 메시지의 data 필드.
 * `event:` 라인은 frame.kind 와 매핑:
 *   - "event"      → 새 HarnessEvent
 *   - "status"     → run.status 가 바뀜 (passed/failed/aborted)
 *   - "snapshot"   → 처음 연결 시 현재까지의 이벤트 전체 (replay)
 *   - "ping"       → 30초 keep-alive
 */
export const HarnessStreamFrameSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("snapshot"),
    run: HarnessRunSummarySchema,
    events: z.array(HarnessEventSummarySchema),
  }),
  z.object({
    kind: z.literal("event"),
    event: HarnessEventSummarySchema,
  }),
  z.object({
    kind: z.literal("status"),
    status: HarnessRunStatusSchema,
    finishedAt: z.string().datetime().nullable(),
  }),
  z.object({
    kind: z.literal("ping"),
    ts: z.string().datetime(),
  }),
]);
export type HarnessStreamFrame = z.infer<typeof HarnessStreamFrameSchema>;
