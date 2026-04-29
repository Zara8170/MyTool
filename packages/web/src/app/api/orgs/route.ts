import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { handleRouteError, conflict } from "@/lib/api-errors";

const CreateOrgSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
});

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const { userId } = await requireAuth(req);

    let body;
    try {
      body = CreateOrgSchema.parse(await req.json());
    } catch {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const existing = await prisma.organization.findUnique({ where: { slug: body.slug } });
    if (existing) throw conflict("Slug already taken");

    const org = await prisma.organization.create({
      data: {
        name: body.name,
        slug: body.slug,
        members: { create: { userId, role: "OWNER" } },
      },
    });

    return NextResponse.json(
      { id: org.id, name: org.name, slug: org.slug, createdAt: org.createdAt.toISOString() },
      { status: 201 },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
