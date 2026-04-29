import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { handleRouteError, forbidden, notFound } from "@/lib/api-errors";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

interface RouteContext {
  params: Promise<{ projectId: string; sessionId: string }>;
}

export async function GET(req: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const { projectId, sessionId } = await context.params;
    const url = new URL(req.url);
    const q = QuerySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
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

    const where = { projectId, sessionId };
    const [total, events] = await Promise.all([
      prisma.event.count({ where }),
      prisma.event.findMany({
        where,
        orderBy: { timestamp: "asc" },
        take: q.limit,
        skip: q.offset,
        select: {
          id: true,
          hookEventName: true,
          toolName: true,
          toolInput: true,
          toolResponse: true,
          exitCode: true,
          isSkillCall: true,
          skillName: true,
          isAgentCall: true,
          agentType: true,
          agentDesc: true,
          isSlashCommand: true,
          slashCommandName: true,
          timestamp: true,
        },
      }),
    ]);

    return NextResponse.json({
      total,
      events: events.map((e) => ({ ...e, timestamp: e.timestamp.toISOString() })),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
