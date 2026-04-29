# Session Outlier Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop 이벤트 수신 시 세션의 이상치 통계를 서버에서 계산해 DB에 저장하고, 대시보드 API와 세션 목록에 노출한다.

**Architecture:** `ClaudeSession`에 집계 컬럼 4개를 추가하고, Stop/SubagentStop 이벤트 처리 후 비동기로 Pre/PostToolUse 페어를 조회해 median × 10 기준으로 이상치를 계산한다. 트랜잭션 외부에서 fire-and-forget으로 실행해 202 응답 지연 없이 처리한다.

**Tech Stack:** Prisma (PostgreSQL), Hono, TypeScript

---

### Task 1: Schema — ClaudeSession에 이상치 컬럼 추가

**Files:**
- Modify: `packages/api/prisma/schema.prisma`

**Step 1: schema.prisma 수정**

`ClaudeSession` 모델에 아래 4개 필드를 추가한다 (`endedAt` 바로 아래):

```prisma
  outlierCount      Int?      // 이상치 툴 호출 횟수
  outlierRatio      Float?    // 이상치 비율 (0.0–1.0)
  slowestToolName   String?   // 가장 느린 툴 이름
  slowestToolMs     Int?      // 가장 느린 툴 소요시간 (ms)
```

**Step 2: 마이그레이션 생성**

```bash
cd packages/api
npx prisma migrate dev --name add_session_outlier_stats
```

Expected: `packages/api/prisma/migrations/..._add_session_outlier_stats/migration.sql` 생성

**Step 3: Prisma client 재생성 확인**

migrate dev가 자동으로 generate까지 실행하지만, 타입 오류가 나면:
```bash
npx prisma generate
```

**Step 4: 빌드 확인**

```bash
cd packages/api
npx tsc --noEmit
```

Expected: 오류 없음

**Step 5: Commit**

```bash
git add packages/api/prisma/schema.prisma packages/api/prisma/migrations/
git commit -m "feat: add outlier stats columns to ClaudeSession"
```

---

### Task 2: 이상치 계산 유틸 함수

**Files:**
- Create: `packages/api/src/lib/outlier.ts`

**Step 1: 유틸 파일 작성**

```typescript
import { prisma } from "../db.js";

export interface OutlierStats {
  outlierCount: number;
  outlierRatio: number;
  slowestToolName: string | null;
  slowestToolMs: number;
}

/**
 * 세션의 Pre/PostToolUse 페어를 조회해 이상치 통계를 계산한다.
 * 기준: durationMs > median(모든 페어 소요시간) * 10
 */
export async function computeSessionOutlierStats(
  sessionId: string,
): Promise<OutlierStats> {
  const preEvents = await prisma.event.findMany({
    where: { sessionId, hookEventName: "PreToolUse" },
    select: { id: true, toolName: true, timestamp: true },
    orderBy: { timestamp: "asc" },
  });

  const postEvents = await prisma.event.findMany({
    where: { sessionId, hookEventName: "PostToolUse" },
    select: { timestamp: true },
    orderBy: { timestamp: "asc" },
  });

  if (preEvents.length === 0) {
    return { outlierCount: 0, outlierRatio: 0, slowestToolName: null, slowestToolMs: 0 };
  }

  // Pre-Post 페어링: 각 Pre에 대해 그 이후 첫 Post를 매칭
  const usedPostIndices = new Set<number>();
  const pairs: { toolName: string | null; durationMs: number }[] = [];

  for (const pre of preEvents) {
    const preTime = new Date(pre.timestamp).getTime();
    for (let i = 0; i < postEvents.length; i++) {
      if (usedPostIndices.has(i)) continue;
      const postTime = new Date(postEvents[i].timestamp).getTime();
      if (postTime >= preTime) {
        pairs.push({
          toolName: pre.toolName,
          durationMs: postTime - preTime,
        });
        usedPostIndices.add(i);
        break;
      }
    }
  }

  if (pairs.length === 0) {
    return { outlierCount: 0, outlierRatio: 0, slowestToolName: null, slowestToolMs: 0 };
  }

  const sorted = [...pairs].sort((a, b) => a.durationMs - b.durationMs);
  const median = sorted[Math.floor(sorted.length / 2)].durationMs;
  const threshold = median * 10;

  const outliers = pairs.filter((p) => p.durationMs > threshold);
  const slowest = sorted[sorted.length - 1];

  return {
    outlierCount: outliers.length,
    outlierRatio: outliers.length / pairs.length,
    slowestToolName: slowest.toolName,
    slowestToolMs: slowest.durationMs,
  };
}
```

**Step 2: 빌드 확인**

```bash
cd packages/api
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add packages/api/src/lib/outlier.ts
git commit -m "feat: add computeSessionOutlierStats utility"
```

---

### Task 3: events.ts — Stop 이벤트 시 이상치 집계

**Files:**
- Modify: `packages/api/src/routes/events.ts`

**Step 1: import 추가**

파일 상단 import 블록에 추가:

```typescript
import { computeSessionOutlierStats } from "../lib/outlier.js";
```

**Step 2: 트랜잭션 이후 fire-and-forget 로직 추가**

트랜잭션 `await prisma.$transaction(...)` 블록 바로 아래, `return c.json(...)` 위에 추가:

```typescript
    // Stop 이벤트가 오면 세션 이상치 통계를 비동기로 집계
    // (202 응답 지연 없이 처리하기 위해 await 없이 실행)
    if (
      event.hookEventName === "Stop" ||
      event.hookEventName === "SubagentStop"
    ) {
      computeSessionOutlierStats(event.sessionId)
        .then((stats) =>
          prisma.claudeSession.update({
            where: { id: event.sessionId },
            data: {
              outlierCount: stats.outlierCount,
              outlierRatio: stats.outlierRatio,
              slowestToolName: stats.slowestToolName,
              slowestToolMs: stats.slowestToolMs,
            },
          }),
        )
        .catch(() => {
          // 집계 실패는 무시 (이벤트 수신 자체는 성공)
        });
    }
```

**Step 3: 빌드 확인**

```bash
cd packages/api
npx tsc --noEmit
```

Expected: 오류 없음

**Step 4: Commit**

```bash
git add packages/api/src/routes/events.ts
git commit -m "feat: compute outlier stats on Stop event"
```

---

### Task 4: dashboard.ts — 세션 목록/상세 응답에 이상치 필드 포함

**Files:**
- Modify: `packages/api/src/routes/dashboard.ts`

**Step 1: 세션 목록 쿼리에 컬럼 추가**

`dashboardRoute.get("/:projectId/dashboard/sessions", ...)` 핸들러 안의 `prisma.claudeSession.findMany` select 블록에 추가:

```typescript
          outlierCount: true,
          outlierRatio: true,
          slowestToolName: true,
          slowestToolMs: true,
```

**Step 2: 세션 목록 응답 매핑에 필드 추가**

세션을 map하는 부분에서 반환 객체에 추가:

```typescript
          outlierCount: s.outlierCount,
          outlierRatio: s.outlierRatio,
          slowestToolName: s.slowestToolName,
          slowestToolMs: s.slowestToolMs,
```

**Step 3: 세션 상세 쿼리에도 동일하게 추가**

`dashboardRoute.get("/:projectId/sessions/:sessionId", ...)` 핸들러의 `prisma.claudeSession.findUnique` 결과와 응답 객체에도 동일한 4개 필드를 추가한다.

**Step 4: 빌드 확인**

```bash
cd packages/api
npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add packages/api/src/routes/dashboard.ts
git commit -m "feat: expose outlier stats in session list and detail APIs"
```

---

### Task 5: 동작 검증

**Step 1: API 서버 재시작 (개발 모드)**

```bash
cd packages/api
npm run dev
```

**Step 2: Stop 이벤트 수동 전송으로 이상치 집계 트리거**

현재 로그인 토큰과 프로젝트 ID를 사용:

```bash
TOKEN=$(cat ~/.mytool/config.json | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
curl -s -X POST http://localhost:3001/api/events \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "cmoh132hr0001v8jkxnjpsdve",
    "sessionId": "e61c40ea-b3cc-44a7-a556-f558794ab138",
    "hookEventName": "Stop",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'"
  }'
```

Expected: `{"ok":true}`

**Step 3: 세션 상세 조회로 이상치 필드 확인**

```bash
TOKEN=$(cat ~/.mytool/config.json | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/projects/cmoh132hr0001v8jkxnjpsdve/sessions/e61c40ea-b3cc-44a7-a556-f558794ab138" \
  | python3 -m json.tool
```

Expected: 응답에 `outlierCount`, `outlierRatio`, `slowestToolName`, `slowestToolMs` 포함

**Step 4: 세션 목록에서도 필드 확인**

```bash
TOKEN=$(cat ~/.mytool/config.json | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/projects/cmoh132hr0001v8jkxnjpsdve/dashboard/sessions" \
  | python3 -m json.tool | head -60
```

Expected: sessions 배열 각 항목에 이상치 필드 포함
