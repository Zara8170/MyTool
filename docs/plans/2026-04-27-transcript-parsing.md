# Transcript Parsing Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Claude Code가 로컬에 저장하는 transcript.jsonl 파일을 파싱해 대화 내역을 DB에 저장하고, 세션 상세 페이지에서 열람할 수 있게 한다.

**Architecture:** CLI가 Stop 이벤트 시 `~/.claude/projects/{경로해시}/` 아래에 있는 transcript JSONL을 읽어 파싱한다. 현재 sessionId에 해당하는 메시지만 추출해 새 API 엔드포인트(`POST /api/projects/:projectId/sessions/:sessionId/messages`)로 전송한다. API는 `Message` 테이블(이미 스키마에 존재)에 저장한다. 웹에서는 세션 상세 페이지에 "대화 내역" 탭을 추가한다.

**Tech Stack:** TypeScript, Node.js fs, Hono, Prisma, Next.js

**Message 테이블 (이미 schema.prisma에 존재):**
```prisma
model Message {
  id        String   @id @default(cuid())
  sessionId String
  role      String   // "human" | "assistant" | "tool"
  content   String   // 50000자 truncate
  orderIdx  Int      // 세션 내 순서
  timestamp DateTime
  createdAt DateTime @default(now())
  session ClaudeSession @relation(...)
  @@unique([sessionId, orderIdx])
}
```

---

### Task 1: CLI — transcript 파일 위치 탐색 유틸

**Files:**
- Create: `packages/cli/src/lib/transcript.ts`

**Context:** Claude Code는 각 프로젝트의 transcript를 `~/.claude/projects/{경로를_URL인코딩한_해시}/` 아래에 `{sessionId}.jsonl` 형식으로 저장한다.
예: `~/.claude/projects/-Users-wlsgu-git-personal-mytool/e61c40ea-b3cc-44a7-a556-f558794ab138.jsonl`

**Step 1: transcript.ts 작성**

```typescript
import fs from "fs";
import os from "os";
import path from "path";

export interface TranscriptMessage {
  role: "human" | "assistant" | "tool";
  content: string;
  timestamp: string; // ISO 8601
}

const CONTENT_LIMIT = 50_000;

/**
 * 현재 작업 디렉토리와 sessionId로 transcript 파일을 찾아 메시지 배열을 반환한다.
 * 파일이 없거나 파싱 실패 시 빈 배열을 반환한다.
 */
export function readTranscriptMessages(
  sessionId: string,
  cwd: string,
): TranscriptMessage[] {
  try {
    const projectHash = encodeProjectPath(cwd);
    const transcriptPath = path.join(
      os.homedir(),
      ".claude",
      "projects",
      projectHash,
      `${sessionId}.jsonl`,
    );

    if (!fs.existsSync(transcriptPath)) return [];

    const lines = fs.readFileSync(transcriptPath, "utf-8").split("\n").filter(Boolean);
    const messages: TranscriptMessage[] = [];

    for (let i = 0; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]!);
        const role = normalizeRole(entry.type ?? entry.role);
        if (!role) continue;

        const content = extractContent(entry);
        if (!content) continue;

        messages.push({
          role,
          content: content.slice(0, CONTENT_LIMIT),
          timestamp: entry.timestamp ?? new Date().toISOString(),
        });
      } catch {
        // 파싱 실패한 줄은 스킵
      }
    }
    return messages;
  } catch {
    return [];
  }
}

function encodeProjectPath(cwd: string): string {
  // Claude Code: 경로의 / 를 - 로 치환, 첫 글자가 / 면 - 로 시작
  return cwd.replace(/\//g, "-").replace(/\\/g, "-");
}

function normalizeRole(
  type: string | undefined,
): "human" | "assistant" | "tool" | null {
  if (!type) return null;
  if (type === "human" || type === "user") return "human";
  if (type === "assistant") return "assistant";
  if (type === "tool" || type === "tool_result") return "tool";
  return null;
}

function extractContent(entry: Record<string, unknown>): string | null {
  if (typeof entry.content === "string") return entry.content;
  if (Array.isArray(entry.content)) {
    return entry.content
      .map((c: unknown) => {
        if (typeof c === "string") return c;
        if (typeof c === "object" && c !== null && "text" in c) {
          return String((c as Record<string, unknown>).text);
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return null;
}
```

**Step 2: 테스트 작성**

`packages/cli/src/lib/transcript.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readTranscriptMessages } from "./transcript.js";
import fs from "fs";
import os from "os";
import path from "path";

describe("readTranscriptMessages", () => {
  it("returns empty array when file does not exist", () => {
    const result = readTranscriptMessages("nonexistent-session-id", "/fake/path");
    expect(result).toEqual([]);
  });

  it("parses human and assistant messages", () => {
    // 임시 파일 생성
    const sessionId = "test-session-abc";
    const projectHash = "-fake-project";
    const dir = path.join(os.homedir(), ".claude", "projects", projectHash);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${sessionId}.jsonl`);
    fs.writeFileSync(
      filePath,
      [
        JSON.stringify({ type: "human", content: "안녕", timestamp: "2026-01-01T00:00:00Z" }),
        JSON.stringify({ type: "assistant", content: "안녕하세요!", timestamp: "2026-01-01T00:00:01Z" }),
      ].join("\n"),
    );

    const result = readTranscriptMessages(sessionId, "/fake/project");
    expect(result).toHaveLength(2);
    expect(result[0]!.role).toBe("human");
    expect(result[0]!.content).toBe("안녕");
    expect(result[1]!.role).toBe("assistant");

    fs.rmSync(filePath);
  });

  it("truncates content over 50000 chars", () => {
    const sessionId = "test-truncate";
    const projectHash = "-fake-project";
    const dir = path.join(os.homedir(), ".claude", "projects", projectHash);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${sessionId}.jsonl`);
    const longContent = "a".repeat(60_000);
    fs.writeFileSync(
      filePath,
      JSON.stringify({ type: "human", content: longContent, timestamp: "2026-01-01T00:00:00Z" }),
    );

    const result = readTranscriptMessages(sessionId, "/fake/project");
    expect(result[0]!.content.length).toBe(50_000);

    fs.rmSync(filePath);
  });
});
```

**Step 3: 테스트 실행**

```bash
cd packages/cli && npx vitest run src/lib/transcript.test.ts
```

Expected: 3 tests passing

**Step 4: Commit**

```bash
git add packages/cli/src/lib/transcript.ts packages/cli/src/lib/transcript.test.ts
git commit -m "feat: add transcript file reader for Claude Code session JSONL"
```

---

### Task 2: Shared Schema — 메시지 인제스트 스키마 추가

**Files:**
- Modify: `packages/shared/src/schemas/events.ts` (또는 새 파일)

**Step 1: MessageBatchSchema 추가**

`packages/shared/src/schemas/events.ts` 끝에 추가:

```typescript
export const MessageItemSchema = z.object({
  role: z.enum(["human", "assistant", "tool"]),
  content: z.string().max(50_000),
  timestamp: z.string().datetime(),
});
export type MessageItem = z.infer<typeof MessageItemSchema>;

export const MessageBatchSchema = z.object({
  messages: z.array(MessageItemSchema).max(2000),
});
export type MessageBatch = z.infer<typeof MessageBatchSchema>;
```

**Step 2: 공유 패키지 빌드**

```bash
cd packages/shared && npm run build
```

Expected: 오류 없음

**Step 3: Commit**

```bash
git add packages/shared/src/schemas/events.ts
git commit -m "feat: add MessageBatch schema for transcript ingestion"
```

---

### Task 3: API — 메시지 저장 엔드포인트

**Files:**
- Modify: `packages/api/src/routes/dashboard.ts`

**Step 1: 메시지 배치 저장 엔드포인트 추가**

`dashboard.ts` 끝에 추가:

```typescript
import { MessageBatchSchema } from "@mytool/shared";

/**
 * POST /api/projects/:projectId/sessions/:sessionId/messages
 * CLI가 Stop 이벤트 후 transcript 파싱 결과를 전송한다.
 * 멱등성: 기존 메시지 전체 삭제 후 재삽입 (세션 단위).
 */
dashboardRoute.post(
  "/:projectId/sessions/:sessionId/messages",
  zValidator("json", MessageBatchSchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const sessionId = c.req.param("sessionId");
    const authUserId = c.get("userId");
    const { messages } = c.req.valid("json");

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project) throw notFound("Project not found");
    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId: authUserId, orgId: project.orgId } },
    });
    if (!membership) throw forbidden();

    if (messages.length === 0) return c.json({ ok: true, saved: 0 });

    await prisma.$transaction(async (tx) => {
      await tx.message.deleteMany({ where: { sessionId } });
      await tx.message.createMany({
        data: messages.map((m, idx) => ({
          sessionId,
          role: m.role,
          content: m.content,
          orderIdx: idx,
          timestamp: new Date(m.timestamp),
        })),
      });
    });

    return c.json({ ok: true, saved: messages.length });
  },
);
```

**Step 2: 타입 체크**

```bash
cd packages/api && npx tsc --noEmit
```

Expected: 오류 없음

**Step 3: Commit**

```bash
git add packages/api/src/routes/dashboard.ts
git commit -m "feat: add POST messages endpoint for transcript ingestion"
```

---

### Task 4: CLI — Stop 이벤트 시 transcript 전송

**Files:**
- Modify: `packages/cli/src/lib/api-client.ts`
- Modify: `packages/cli/src/commands/main.ts`

**Step 1: api-client.ts에 sendMessages 추가**

```typescript
  async sendMessages(
    apiUrl: string,
    token: string,
    projectId: string,
    sessionId: string,
    messages: import("@mytool/shared").MessageItem[],
  ): Promise<{ ok: true; saved: number }> {
    return request<{ ok: true; saved: number }>(
      `${apiUrl}/api/projects/${projectId}/sessions/${sessionId}/messages`,
      {
        method: "POST",
        body: { messages },
        token,
        timeoutMs: 10_000,
      },
    );
  },
```

**Step 2: main.ts의 Stop 이벤트 처리 부분에 transcript 전송 추가**

현재 hook 이벤트를 처리하는 부분에서 `hookEventName === "Stop"` 조건 블록을 찾아 아래 로직 추가:

```typescript
  // Stop 이벤트면 transcript 전송 (실패해도 hook은 0 종료)
  if (event.hookEventName === "Stop" && event.sessionId && event.projectId) {
    try {
      const messages = readTranscriptMessages(event.sessionId, process.cwd());
      if (messages.length > 0) {
        await api.sendMessages(
          config.apiUrl,
          config.token,
          event.projectId,
          event.sessionId,
          messages,
        );
      }
    } catch {
      // 전송 실패해도 hook 응답에 영향 없음
    }
  }
```

import 추가:
```typescript
import { readTranscriptMessages } from "../lib/transcript.js";
```

**Step 3: CLI 빌드**

```bash
cd packages/cli && npm run build
```

Expected: 오류 없음

**Step 4: Commit**

```bash
git add packages/cli/src/lib/api-client.ts packages/cli/src/commands/main.ts
git commit -m "feat: send transcript messages to API on Stop event"
```

---

### Task 5: API — 세션 상세에 메시지 수 포함

**Files:**
- Modify: `packages/api/src/routes/dashboard.ts`
- Modify: `packages/shared/src/schemas/dashboard.ts`

**Step 1: SessionDetailSchema에 messageCount 추가**

```typescript
  messageCount: z.number().int(),
```

**Step 2: 세션 상세 쿼리에 메시지 수 포함**

`prisma.claudeSession.findUnique` 쿼리의 `include`에 추가:

```typescript
      _count: { select: { events: true, messages: true } },
```

응답에 추가:
```typescript
    messageCount: session._count.messages,
```

**Step 3: 타입 체크**

```bash
cd packages/shared && npm run build
cd packages/api && npx tsc --noEmit
cd packages/web && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add packages/api/src/routes/dashboard.ts packages/shared/src/schemas/dashboard.ts
git commit -m "feat: include messageCount in session detail response"
```

---

### Task 6: Web — 세션 상세에 대화 내역 탭

**Files:**
- Create: `packages/web/src/app/api/sessions/[sessionId]/messages/route.ts`
- Create: `packages/web/src/app/dashboard/[projectId]/sessions/[sessionId]/transcript/page.tsx`
- Modify: `packages/web/src/app/dashboard/[projectId]/sessions/[sessionId]/page.tsx`

**Step 1: 메시지 fetch API 라우트 생성**

`packages/web/src/app/api/sessions/[sessionId]/messages/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { serverFetch } from "@/lib/server-api";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  // 실제 구현에서는 projectId도 필요 — 여기서는 서버 fetch 경유
  return NextResponse.json({ sessionId });
}
```

**Step 2: transcript 페이지 생성**

`packages/web/src/app/dashboard/[projectId]/sessions/[sessionId]/transcript/page.tsx`:

```typescript
import Link from "next/link";
import { serverFetch } from "@/lib/server-api";

interface Message {
  id: string;
  role: "human" | "assistant" | "tool";
  content: string;
  orderIdx: number;
  timestamp: string;
}

interface MessageListResponse {
  messages: Message[];
  total: number;
}

interface PageProps {
  params: Promise<{ projectId: string; sessionId: string }>;
}

export default async function TranscriptPage({ params }: PageProps) {
  const { projectId, sessionId } = await params;

  const data = await serverFetch<MessageListResponse>(
    `/api/projects/${projectId}/sessions/${sessionId}/messages`,
  );

  return (
    <div className="space-y-6">
      <header>
        <Link
          href={`/dashboard/${projectId}/sessions/${sessionId}`}
          className="text-sm text-muted hover:text-text"
        >
          ← Session detail
        </Link>
        <h1 className="text-2xl font-bold mt-2">대화 내역</h1>
        <p className="text-muted text-sm">{data.total}개 메시지</p>
      </header>

      {data.messages.length === 0 ? (
        <div className="bg-panel border rounded-lg p-8 text-center text-muted text-sm">
          저장된 대화 내역이 없습니다.
        </div>
      ) : (
        <div className="space-y-3">
          {data.messages.map((msg) => (
            <div
              key={msg.id}
              className={`rounded-lg p-4 text-sm ${
                msg.role === "human"
                  ? "bg-blue-950/30 border border-blue-900/40"
                  : msg.role === "assistant"
                    ? "bg-panel border"
                    : "bg-zinc-900/40 border border-zinc-800 font-mono text-xs"
              }`}
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                  {msg.role}
                </span>
                <span className="text-xs text-muted">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <pre className="whitespace-pre-wrap break-words font-sans">
                {msg.content}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 3: 세션 상세 페이지 헤더에 대화 내역 링크 추가**

`page.tsx` 헤더 영역에 추가:

```tsx
        {session.messageCount > 0 && (
          <Link
            href={`/dashboard/${projectId}/sessions/${sessionId}/transcript`}
            className="text-sm text-accent hover:underline"
          >
            대화 내역 {session.messageCount}개 →
          </Link>
        )}
```

**Step 4: messages 엔드포인트 추가** (`dashboard.ts`)

```typescript
/**
 * GET /api/projects/:projectId/sessions/:sessionId/messages
 */
dashboardRoute.get("/:projectId/sessions/:sessionId/messages", async (c) => {
  const projectId = c.req.param("projectId");
  const sessionId = c.req.param("sessionId");
  const authUserId = c.get("userId");

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { orgId: true },
  });
  if (!project) throw notFound("Project not found");
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: authUserId, orgId: project.orgId } },
  });
  if (!membership) throw forbidden();

  const [total, messages] = await Promise.all([
    prisma.message.count({ where: { sessionId } }),
    prisma.message.findMany({
      where: { sessionId },
      orderBy: { orderIdx: "asc" },
      take: 500,
    }),
  ]);

  return c.json({
    total,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      orderIdx: m.orderIdx,
      timestamp: m.timestamp.toISOString(),
    })),
  });
});
```

**Step 5: 타입 체크**

```bash
cd packages/api && npx tsc --noEmit
cd packages/web && npx tsc --noEmit
```

Expected: 오류 없음

**Step 6: Commit**

```bash
git add packages/api/src/routes/dashboard.ts \
        packages/web/src/app/dashboard/\[projectId\]/sessions/\[sessionId\]/transcript/ \
        packages/web/src/app/dashboard/\[projectId\]/sessions/\[sessionId\]/page.tsx
git commit -m "feat: add transcript viewer page and messages API endpoint"
```

---

### Task 7: 동작 검증

**Step 1: API 재빌드 및 재시작**

```bash
cd packages/api && npm run build && cd ../.. && node packages/api/dist/index.js &
sleep 2 && curl -s http://localhost:3001/health
```

**Step 2: Stop 이벤트 전송 (CLI hook 실행)**

실제 Claude Code 세션에서 작업 완료 후 Stop 훅이 자동으로 실행되거나, 아래로 수동 테스트:

```bash
# 수동으로 Stop 이벤트 전송 (transcript 전송 없이 API만 테스트)
TOKEN=$(cat ~/.mytool/config.json | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
curl -s -X POST http://localhost:3001/api/events \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"cmoh132hr0001v8jkxnjpsdve\",\"sessionId\":\"e61c40ea-b3cc-44a7-a556-f558794ab138\",\"hookEventName\":\"Stop\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"}"
```

**Step 3: messages 테이블 확인**

```bash
docker exec mytool-postgres psql -U mytool -d mytool \
  -c "SELECT role, LEFT(content, 50), \"orderIdx\" FROM messages WHERE \"sessionId\" = 'e61c40ea-b3cc-44a7-a556-f558794ab138' ORDER BY \"orderIdx\" LIMIT 5;"
```

Expected: human/assistant 메시지 행들이 출력됨

**Step 4: 웹 UI 확인**

브라우저에서 세션 상세 페이지 열고 "대화 내역 N개 →" 링크 클릭 → transcript 페이지에서 메시지 목록 확인
