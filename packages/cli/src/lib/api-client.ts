import type {
  AuthResponse,
  IngestEvent,
  MessageItem,
  MeResponse,
  Project,
  Organization,
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
};
