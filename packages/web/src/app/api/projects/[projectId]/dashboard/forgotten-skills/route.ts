import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { handleRouteError, forbidden, notFound } from "@/lib/api-errors";

const QuerySchema = z.object({
  userId: z.string(),
});

export async function GET(
  req: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const { projectId } = await context.params;
    const url = new URL(req.url);
    const { userId: targetUserId } = QuerySchema.parse({
      userId: url.searchParams.get("userId"),
    });

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project) throw notFound("Project not found");
    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId: authUserId, orgId: project.orgId } },
    });
    if (!membership) throw forbidden();

    const now = new Date();
    const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [pastSkillsRaw, recentSkillsRaw] = await Promise.all([
      prisma.event.findMany({
        where: {
          projectId,
          userId: targetUserId,
          isSkillCall: true,
          skillName: { not: null },
          timestamp: { gte: fourWeeksAgo },
        },
        select: { skillName: true, timestamp: true },
        orderBy: { timestamp: "desc" },
      }),
      prisma.event.findMany({
        where: {
          projectId,
          userId: targetUserId,
          isSkillCall: true,
          skillName: { not: null },
          timestamp: { gte: oneWeekAgo },
        },
        select: { skillName: true },
        distinct: ["skillName"],
      }),
    ]);

    const recentSkills = new Set(recentSkillsRaw.map((e) => e.skillName!));

    const lastUsedMap = new Map<string, string>();
    for (const e of pastSkillsRaw) {
      if (!lastUsedMap.has(e.skillName!)) {
        lastUsedMap.set(e.skillName!, e.timestamp.toISOString());
      }
    }

    const forgottenSkills = [...lastUsedMap.entries()]
      .filter(([skillName]) => !recentSkills.has(skillName))
      .map(([skillName, lastUsedAt]) => ({ skillName, lastUsedAt }))
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));

    return NextResponse.json({ forgottenSkills });
  } catch (err) {
    return handleRouteError(err);
  }
}
