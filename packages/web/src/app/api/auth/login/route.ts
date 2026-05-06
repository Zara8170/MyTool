import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/db";
import { signJwt, hashToken, tokenExpiresAt } from "@/lib/jwt";
import { handleRouteError, unauthorized } from "@/lib/api-errors";

const BodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  kind: z.enum(["web", "cli"]).optional().default("cli"),
});

export async function POST(req: Request): Promise<NextResponse> {
  try {
    let body;
    try {
      body = BodySchema.parse(await req.json());
    } catch {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) throw unauthorized("Invalid email or password");

    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) throw unauthorized("Invalid email or password");

    const kind = body.kind;
    const token = await signJwt({ sub: user.id, email: user.email, kind });
    const expiresAt = tokenExpiresAt(kind);

    await prisma.cliToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        kind: kind === "cli" ? "CLI" : "WEB",
        label: "CLI",
        expiresAt,
      },
    });

    return NextResponse.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
      kind,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
