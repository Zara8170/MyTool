import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { handleRouteError, forbidden } from "@/lib/api-errors";

interface RouteContext {
  params: Promise<{ orgId: string }>;
}

export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  try {
    await requireAuth(req);
    await context.params;

    throw forbidden(
      "Joining an existing organization requires an invite (not yet implemented). " +
        "Use your own organization for now.",
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
