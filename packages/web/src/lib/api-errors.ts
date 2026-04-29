import "server-only";
import { NextResponse } from "next/server";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function unauthorized(message = "Authentication required"): ApiError {
  return new ApiError(401, "UNAUTHORIZED", message);
}

export function forbidden(message = "Forbidden"): ApiError {
  return new ApiError(403, "FORBIDDEN", message);
}

export function notFound(message = "Not found"): ApiError {
  return new ApiError(404, "NOT_FOUND", message);
}

export function conflict(message = "Conflict"): ApiError {
  return new ApiError(409, "CONFLICT", message);
}

export function apiErrorResponse(err: ApiError): NextResponse {
  const body: Record<string, unknown> = {
    error: { code: err.code, message: err.message },
  };
  if (err.details !== undefined) {
    (body.error as Record<string, unknown>).details = err.details;
  }
  return NextResponse.json(body, { status: err.status });
}

export function handleRouteError(err: unknown): NextResponse {
  if (err instanceof ApiError) return apiErrorResponse(err);
  console.error("[route error]", err);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    { status: 500 },
  );
}
