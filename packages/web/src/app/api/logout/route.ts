import { NextResponse } from "next/server";
import { clearAuthToken, getAuthToken } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hashToken, verifyJwt } from "@/lib/jwt";

export async function POST(): Promise<NextResponse> {
  const token = await getAuthToken();
  if (token) {
    try {
      await verifyJwt(token);
      const tokenHash = hashToken(token);
      await prisma.cliToken.update({
        where: { tokenHash },
        data: { revokedAt: new Date() },
      });
    } catch {
      // invalid token is fine — just clear the cookie
    }
  }
  await clearAuthToken();
  return NextResponse.json({ ok: true });
}
