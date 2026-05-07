import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { CreateProjectSchema, PatchProjectSchema } from "@mytool/shared";
import { prisma } from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { conflict, forbidden, notFound } from "../lib/errors.js";

export const projectsRoute = new Hono();
projectsRoute.use("*", authMiddleware);

async function requireMembership(userId: string, orgId: string) {
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId } },
  });
  if (!membership) throw forbidden("Not a member of this project's organization");
  return membership;
}

/**
 * POST /api/projects
 */
projectsRoute.post(
  "/",
  zValidator("json", CreateProjectSchema),
  async (c) => {
    const userId = c.get("userId");
    const { orgId, name, slug } = c.req.valid("json");

    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });
    if (!membership) throw forbidden("Not a member of this organization");

    const existing = await prisma.project.findUnique({
      where: { orgId_slug: { orgId, slug } },
    });
    if (existing) throw conflict("Project slug already exists in this organization");

    const project = await prisma.project.create({
      data: { orgId, name, slug },
    });

    return c.json(serialize(project), 201);
  },
);

/**
 * GET /api/projects/:projectId
 */
projectsRoute.get("/:projectId", async (c) => {
  const userId = c.get("userId");
  const projectId = c.req.param("projectId");

  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) throw notFound("Project not found");
  await requireMembership(userId, project.orgId);
  return c.json(serialize(project));
});

/**
 * PATCH /api/projects/:projectId
 *
 * 4축 워크스페이스 토글 (integration-plan §0, PR 1) 갱신용.
 * 부분 업데이트 — 보낸 필드만 반영.
 */
projectsRoute.patch(
  "/:projectId",
  zValidator("json", PatchProjectSchema),
  async (c) => {
    const userId = c.get("userId");
    const projectId = c.req.param("projectId");
    const patch = c.req.valid("json");

    const existing = await prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!existing) throw notFound("Project not found");
    await requireMembership(userId, existing.orgId);

    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.syncEnabled !== undefined) data.syncEnabled = patch.syncEnabled;
    if (patch.harnessEnabled !== undefined) data.harnessEnabled = patch.harnessEnabled;
    if (patch.harnessConfig !== undefined) {
      data.harnessConfig = patch.harnessConfig === null ? null : patch.harnessConfig;
    }

    const updated =
      Object.keys(data).length === 0
        ? await prisma.project.findUnique({ where: { id: projectId } })
        : await prisma.project.update({ where: { id: projectId }, data });

    if (!updated) throw notFound("Project not found");
    return c.json(serialize(updated));
  },
);

function serialize(p: {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  createdAt: Date;
  syncEnabled: boolean;
  harnessEnabled: boolean;
  harnessConfig: unknown;
}) {
  return {
    id: p.id,
    orgId: p.orgId,
    name: p.name,
    slug: p.slug,
    createdAt: p.createdAt.toISOString(),
    syncEnabled: p.syncEnabled,
    harnessEnabled: p.harnessEnabled,
    harnessConfig: p.harnessConfig,
  };
}
