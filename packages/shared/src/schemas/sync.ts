// PR 3 — Sync push/pull 모델 (integration-plan §6.1, §10a).
// `@mytool/sync` 가 다루는 SyncItem/SyncManifest 타입은 그쪽에 그대로 있고,
// 여기서는 API 의 request/response 와 DB 직렬화 형식만 정의한다.

import { z } from "zod";

// ── Item / Manifest (sync 라이브러리와 호환) ──────────────────────────

export const SyncItemTypeSchema = z.enum([
  "global:skill",
  "global:agent",
  "global:command",
  "global:settings",
  "global:claude-md",
  "project:skill",
  "project:agent",
  "project:command",
  "project:hookify",
  "project:settings",
  "project:settings-local",
  "project:claude-md",
  "project:agents-md",
  "project:claude-doc",
  "project:mcp",
]);
export type SyncItemType = z.infer<typeof SyncItemTypeSchema>;

export const SyncManifestItemSchema = z.object({
  /** PR 3 추가: API 가 발급한 안정 식별자. job 의 itemIds 가 이걸 가리킨다. */
  id: z.string().min(1),
  type: SyncItemTypeSchema,
  scope: z.enum(["global", "project"]),
  name: z.string(),
  project: z.string().nullable(),
  sourceProjectRoot: z.string().nullable(),
  /** 원본 절대경로. 마스킹·디버그·UI 표시용. */
  sourceAbsPath: z.string(),
  /** 번들 안의 상대경로. */
  relPath: z.string(),
  size: z.number().int().nonnegative(),
});
export type SyncManifestItem = z.infer<typeof SyncManifestItemSchema>;

export const SyncManifestSchema = z.object({
  version: z.number().int().positive(),
  createdAt: z.string(),
  sourceHost: z.string().optional(),
  sourcePlatform: z.string().optional(),
  masked: z.boolean().optional(),
  items: z.array(SyncManifestItemSchema),
});
export type SyncManifest = z.infer<typeof SyncManifestSchema>;

// ── Device ────────────────────────────────────────────────────────────

export const RegisterDeviceSchema = z.object({
  /** 사용자 지정 이름. 미지정 시 hostname 사용. */
  name: z.string().min(1).max(100).optional(),
  hostname: z.string().min(1).max(255),
  platform: z.string().min(1).max(64),
});
export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceSchema>;

export const DeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  hostname: z.string(),
  platform: z.string(),
  lastSeenAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type Device = z.infer<typeof DeviceSchema>;

// ── Snapshot ──────────────────────────────────────────────────────────

export const CreateSnapshotSchema = z.object({
  /** orgId 는 토큰 user 의 org 중에서 골라 보낸다. 보통 user 의 단일 org. */
  orgId: z.string().min(1),
  manifest: SyncManifestSchema,
});
export type CreateSnapshotRequest = z.infer<typeof CreateSnapshotSchema>;

export const SnapshotSummarySchema = z.object({
  id: z.string(),
  orgId: z.string(),
  deviceId: z.string(),
  device: DeviceSchema,
  createdBy: z.string(),
  createdAt: z.string().datetime(),
  hasBundle: z.boolean(),
  masked: z.boolean(),
  itemCount: z.number().int().nonnegative(),
});
export type SnapshotSummary = z.infer<typeof SnapshotSummarySchema>;

export const SnapshotDetailSchema = SnapshotSummarySchema.extend({
  manifest: SyncManifestSchema,
});
export type SnapshotDetail = z.infer<typeof SnapshotDetailSchema>;

// ── Job ───────────────────────────────────────────────────────────────

export const SyncJobOptionsSchema = z.object({
  /** mask 옵션이 다시 적용되어야 하는지 (snapshot 자체에 마스킹된 게 아니면 cli 가 추가 적용). */
  mask: z.boolean().default(false),
  overwrite: z.enum(["backup", "force", "skip"]).default("backup"),
});
export type SyncJobOptions = z.infer<typeof SyncJobOptionsSchema>;

export const CreateJobSchema = z.object({
  sourceSnapshotId: z.string().min(1),
  targetDeviceId: z.string().min(1),
  /** project scope item 적용 시 어디에 적용할지. global 만 있으면 비움. */
  targetProjectId: z.string().min(1).optional(),
  itemIds: z.array(z.string().min(1)).min(1),
  options: SyncJobOptionsSchema,
});
export type CreateJobRequest = z.infer<typeof CreateJobSchema>;

export const SyncJobStatusSchema = z.enum([
  "pending",
  "running",
  "done",
  "failed",
  "partial",
]);
export type SyncJobStatus = z.infer<typeof SyncJobStatusSchema>;

export const SyncJobResultSchema = z.object({
  applied: z.array(z.string()).default([]),
  skipped: z.array(z.string()).default([]),
  errors: z
    .array(z.object({ itemId: z.string(), message: z.string() }))
    .default([]),
});
export type SyncJobResult = z.infer<typeof SyncJobResultSchema>;

export const ReportJobResultSchema = z.object({
  status: SyncJobStatusSchema,
  result: SyncJobResultSchema,
});
export type ReportJobResultRequest = z.infer<typeof ReportJobResultSchema>;

export const SyncJobSummarySchema = z.object({
  id: z.string(),
  orgId: z.string(),
  sourceSnapshotId: z.string(),
  targetDeviceId: z.string(),
  targetProjectId: z.string().nullable(),
  itemIds: z.array(z.string()),
  options: SyncJobOptionsSchema,
  status: SyncJobStatusSchema,
  result: SyncJobResultSchema.nullable(),
  createdBy: z.string(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});
export type SyncJobSummary = z.infer<typeof SyncJobSummarySchema>;

/** cli sync pull 이 작업 처리에 필요한 정보 — bundle URL 포함. */
export const SyncJobWorkSchema = SyncJobSummarySchema.extend({
  /** bundle 다운로드용 short-lived URL. local 백엔드면 api 라우트 자체. */
  bundleUrl: z.string(),
  /** 같은 sourceSnapshotId 의 manifest 도 같이 (cli 가 manifest 만으로 적용 가능). */
  manifest: SyncManifestSchema,
});
export type SyncJobWork = z.infer<typeof SyncJobWorkSchema>;
