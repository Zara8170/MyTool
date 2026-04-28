import "server-only";
import { getAuthToken } from "./auth";

// Vercel 배포 시: VERCEL_URL이 자동 설정됨 (자신의 API routes 호출)
// 로컬 개발 시: API_URL 또는 Next.js dev server URL 사용
function getApiUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return process.env.API_URL ?? "http://localhost:18101";
}
const API_URL = getApiUrl();

export class ServerApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type NextFetchConfig = { revalidate?: number | false; tags?: string[] };

export async function serverFetch<T>(
  path: string,
  init: Omit<RequestInit, "next"> & { next?: NextFetchConfig } = {},
): Promise<T> {
  const { next, ...restInit } = init;
  const token = await getAuthToken();
  const headers = new Headers(restInit.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, {
    ...restInit,
    headers,
    ...(next ? { next } : { cache: "no-store" }),
  });

  if (!res.ok) {
    let code = "HTTP_ERROR";
    let message = `${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string };
      };
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      // ignore
    }
    throw new ServerApiError(res.status, code, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
