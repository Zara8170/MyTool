import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "GONE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export class ApiError extends HTTPException {
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(
    status: ContentfulStatusCode,
    code: ErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(status, { message });
    this.code = code;
    if (details !== undefined) this.details = details;
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

export function rateLimited(message = "Too many requests"): ApiError {
  return new ApiError(429, "RATE_LIMITED", message);
}

export function validationError(details: unknown): ApiError {
  return new ApiError(
    400,
    "VALIDATION_ERROR",
    "Request validation failed",
    details,
  );
}

export function errorResponse(c: Context, err: ApiError) {
  const body: ApiErrorBody = {
    error: {
      code: err.code,
      message: err.message,
    },
  };
  if (err.details !== undefined) body.error.details = err.details;
  return c.json(body, err.status);
}
