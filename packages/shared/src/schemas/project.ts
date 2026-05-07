import { z } from "zod";

const SlugSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase alphanumeric with hyphens");

export const CreateOrgSchema = z.object({
  name: z.string().min(1).max(100),
  slug: SlugSchema,
});
export type CreateOrgRequest = z.infer<typeof CreateOrgSchema>;

export const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string().datetime(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const CreateProjectSchema = z.object({
  orgId: z.string().min(1),
  name: z.string().min(1).max(100),
  slug: SlugSchema,
});
export type CreateProjectRequest = z.infer<typeof CreateProjectSchema>;

// 4축 워크스페이스 토글 (integration-plan §0)
export const ProjectSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string().datetime(),
  syncEnabled: z.boolean().default(true),
  harnessEnabled: z.boolean().default(false),
  harnessConfig: z.unknown().nullable().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

// PATCH /api/projects/:id — 토글·이름 등 부분 업데이트
export const PatchProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  syncEnabled: z.boolean().optional(),
  harnessEnabled: z.boolean().optional(),
  harnessConfig: z.unknown().optional(),
});
export type PatchProjectRequest = z.infer<typeof PatchProjectSchema>;
