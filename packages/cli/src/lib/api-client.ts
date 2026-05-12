import type {
  AuthResponse,
  IngestEvent,
  MessageItem,
  MeResponse,
  Project,
  Organization,
  Device,
  RegisterDeviceRequest,
  CreateSnapshotRequest,
  SnapshotSummary,
  SyncJobSummary,
  SyncJobWork,
  ReportJobResultRequest,
} from "@mytool/shared";

const USER_AGENT = "mytool-cli";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

interface RequestOpts {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  token?: string | undefined;
  /** 타임아웃(ms). hook 발화 시에는 3000ms 강제. */
  timeoutMs?: number;
}

async function request<T>(
  apiUrl: string,
  path: string,
  opts: RequestOpts = {},
): Promise<T> {
  const url = `${apiUrl.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };
  if (opts.token) {
    headers["Authorization"] = `Bearer ${opts.token}`;
  }

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      signal: controller.signal,
    });

    if (!res.ok) {
      let code = "HTTP_ERROR";
      let message = `${res.status} ${res.statusText}`;
      try {
        const err = (await res.json()) as {
          error?: { code?: string; message?: string };
        };
        if (err.error?.code) code = err.error.code;
        if (err.error?.message) message = err.error.message;
      } catch {
        // ignore body parse error
      }
      throw new ApiClientError(res.status, code, message);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ----- Public API methods -----

export const api = {
  register(apiUrl: string, body: { email: string; password: string; name?: string }) {
    return request<AuthResponse>(apiUrl, "/api/auth/register", {
      method: "POST",
      body: { ...body, kind: "cli" },
    });
  },

  login(apiUrl: string, body: { email: string; password: string }) {
    return request<AuthResponse>(apiUrl, "/api/auth/login", {
      method: "POST",
      body: { ...body, kind: "cli" },
    });
  },

  logout(apiUrl: string, token: string) {
    return request<{ ok: true }>(apiUrl, "/api/auth/session", {
      method: "DELETE",
      token,
    });
  },

  me(apiUrl: string, token: string) {
    return request<MeResponse>(apiUrl, "/api/auth/me", { token });
  },

  createOrg(
    apiUrl: string,
    token: string,
    body: { name: string; slug: string },
  ) {
    return request<Organization>(apiUrl, "/api/orgs", {
      method: "POST",
      token,
      body,
    });
  },

  createProject(
    apiUrl: string,
    token: string,
    body: { orgId: string; name: string; slug: string },
  ) {
    return request<Project>(apiUrl, "/api/projects", {
      method: "POST",
      token,
      body,
    });
  },

  /** Hook 이벤트 전송 - 3초 hard timeout */
  sendEvent(apiUrl: string, token: string, event: IngestEvent) {
    return request<{ ok: true }>(apiUrl, "/api/events", {
      method: "POST",
      token,
      body: event,
      timeoutMs: 3000,
    });
  },

  sendMessages(
    apiUrl: string,
    token: string,
    projectId: string,
    sessionId: string,
    messages: MessageItem[],
  ) {
    return request<{ ok: true; saved: number }>(
      apiUrl,
      `/api/projects/${projectId}/sessions/${sessionId}/messages`,
      {
        method: "POST",
        token,
        body: { messages },
        timeoutMs: 10_000,
      },
    );
  },

  // ─── PR 3 — Sync push/pull ─────────────────────────────────────

  registerDevice(apiUrl: string, token: string, body: RegisterDeviceRequest) {
    return request<Device>(apiUrl, "/api/sync/devices", {
      method: "POST",
      token,
      body,
    });
  },

  listDevices(apiUrl: string, token: string) {
    return request<Device[]>(apiUrl, "/api/sync/devices", { token });
  },

  createSnapshot(apiUrl: string, token: string, body: CreateSnapshotRequest) {
    return request<{ id: string; orgId: string; deviceId: string; createdAt: string }>(
      apiUrl,
      "/api/sync/snapshots",
      { method: "POST", token, body, timeoutMs: 30_000 },
    );
  },

  /** bundle zip 업로드 — raw bytes (application/zip). */
  async uploadBundle(
    apiUrl: string,
    token: string,
    snapshotId: string,
    zipBuffer: Buffer,
  ): Promise<{ ok: true; size: number }> {
    const url = `${apiUrl.replace(/\/$/, "")}/api/sync/snapshots/${snapshotId}/bundle`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/zip",
          "User-Agent": USER_AGENT,
        },
        body: zipBuffer,
        signal: controller.signal,
      });
      if (!res.ok) {
        let code = "HTTP_ERROR";
        let message = `${res.status} ${res.statusText}`;
        try {
          const err = (await res.json()) as { error?: { code?: string; message?: string } };
          if (err.error?.code) code = err.error.code;
          if (err.error?.message) message = err.error.message;
        } catch {
          /* ignore */
        }
        throw new ApiClientError(res.status, code, message);
      }
      return (await res.json()) as { ok: true; size: number };
    } finally {
      clearTimeout(timer);
    }
  },

  listSnapshots(apiUrl: string, token: string) {
    return request<SnapshotSummary[]>(apiUrl, "/api/sync/snapshots", { token });
  },

  listJobs(
    apiUrl: string,
    token: string,
    opts: { deviceId?: string; status?: string } = {},
  ) {
    const qs = new URLSearchParams();
    if (opts.deviceId) qs.set("deviceId", opts.deviceId);
    if (opts.status) qs.set("status", opts.status);
    const query = qs.toString();
    return request<SyncJobSummary[]>(
      apiUrl,
      `/api/sync/jobs${query ? "?" + query : ""}`,
      { token },
    );
  },

  getJob(apiUrl: string, token: string, jobId: string) {
    return request<SyncJobWork>(apiUrl, `/api/sync/jobs/${jobId}`, {
      token,
      timeoutMs: 30_000,
    });
  },

  reportJobResult(
    apiUrl: string,
    token: string,
    jobId: string,
    body: ReportJobResultRequest,
  ) {
    return request<SyncJobSummary>(apiUrl, `/api/sync/jobs/${jobId}/result`, {
      method: "POST",
      token,
      body,
    });
  },

  /** bundle zip 다운로드 (signed URL 또는 우리 라우트). 응답 buffer 반환. */
  async downloadBundle(url: string, token: string): Promise<Buffer> {
    const isOurRoute = url.includes("/api/sync/");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(url, {
        headers: isOurRoute
          ? { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT }
          : { "User-Agent": USER_AGENT },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new ApiClientError(
          res.status,
          "HTTP_ERROR",
          `${res.status} ${res.statusText}`,
        );
      }
      const arr = await res.arrayBuffer();
      return Buffer.from(arr);
    } finally {
      clearTimeout(timer);
    }
  },
};
