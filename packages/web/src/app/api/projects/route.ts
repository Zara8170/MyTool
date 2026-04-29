import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { handleRouteError, forbidden, conflict } from "@/lib/api-errors";

const CreateProjectSchema = z.object({
  orgId: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
});

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { userId } = await requireAuth(req);

    let body;
    try {
      body = CreateProjectSchema.parse(await req.json());
    } catch {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId: body.orgId } },
    });
    if (!membership) throw forbidden("Not a member of this organization");

    const existing = await prisma.project.findUnique({
      where: { orgId_slug: { orgId: body.orgId, slug: body.slug } },
    });
    if (existing) throw conflict("Project slug already exists in this organization");

    const project = await prisma.project.create({
      data: { orgId: body.orgId, name: body.name, slug: body.slug },
    });

    return NextResponse.json(
      {
        id: project.id,
        orgId: project.orgId,
        name: project.name,
        slug: project.slug,
        createdAt: project.createdAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
