# Outlier Event Log Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 세션별 이상치 요약 1개 대신 툴 호출별 이상치 이벤트를 개별 로그로 저장해, 여러 세션에 걸쳐 반복되는 이상치 패턴을 쿼리 한 번으로 추적할 수 있게 한다.

**Architecture:** `SessionOutlierEvent` 테이블을 새로 추가해 Stop 이벤트 시 이상치 판정된 툴 호출 각각을 저장한다. `ClaudeSession`의 `slowestToolName`/`slowestToolMs`는 새 테이블로 대체되어 제거하고, 빠른 필터링용 `outlierCount`/`outlierRatio`는 유지한다. 크로스-세션 집계는 대시보드 summary 엔드포인트에 툴별 통계를 추가해 노출한다.

**Tech Stack:** Prisma (PostgreSQL), Hono, TypeScript

---

### Task 1: Schema 변경 — SessionOutlierEvent 추가, slowestTool 컬럼 제거

**Files:**
- Modify: `packages/api/prisma/schema.prisma`

**Step 1: ClaudeSession에서 slowestTool 컬럼 2개 제거**

`schema.prisma`의 `ClaudeSession` 모델에서 아래 두 줄을 삭제한다:

```prisma
  slowestToolName String? // 가장 느린 툴 이름
  slowestToolMs   Int?    // 가장 느린 툴 소요시간 (ms)
```

그리고 `outlierEvents` relation을 추가한다 (`createdAt` 바로 위):

```prisma
  outlierEvents SessionOutlierEvent[]
```

**Step 2: SessionOutlierEvent 모델 추가**

`UsageRecord` 모델 바로 아래에 추가:

```prisma
model SessionOutlierEvent {
  id         String   @id @default(cuid())
  sessionId  String
  projectId  String
  toolName   String
  durationMs Int
  medianMs   Int
  createdAt  DateTime @default(now())

  session ClaudeSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  project Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId, toolName])
  @@index([sessionId])
  @@map("session_outlier_events")
}
```

**Step 3: Project 모델에 relation 추가**

`Project` 모델의 relation 목록 끝에 추가:

```prisma
  outlierEvents SessionOutlierEvent[]
```

**Step 4: 마이그레이션 SQL 파일 수동 생성**

```bash
TIMESTAMP=$(date -u +%Y%m%d%H%M%S)
mkdir -p "packages/api/prisma/migrations/${TIMESTAMP}_add_outlier_event_log"
```

아래 내용으로 `migration.sql` 작성:

```sql
-- Remove slowestTool columns from claude_sessions
ALTER TABLE "claude_sessions"
  DROP COLUMN IF EXISTS "slowestToolName",
  DROP COLUMN IF EXISTS "slowestToolMs";

-- Create session_outlier_events table
CREATE TABLE "session_outlier_events" (
  "id"         TEXT NOT NULL,
  "sessionId"  TEXT NOT NULL,
  "projectId"  TEXT NOT NULL,
  "toolName"   TEXT NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "medianMs"   INTEGER NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "session_outlier_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "session_outlier_events"
  ADD CONSTRAINT "session_outlier_events_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "claude_sessions"("id")
    ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "session_outlier_events"
  ADD CONSTRAINT "session_outlier_events_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX "session_outlier_events_projectId_toolName_idx"
  ON "session_outlier_events"("projectId", "toolName");

CREATE INDEX "session_outlier_events_sessionId_idx"
  ON "session_outlier_events"("sessionId");
```

**Step 5: Docker psql로 마이그레이션 적용**

```bash
docker exec mytool-postgres psql -U mytool -d mytool \
  -f /dev/stdin << 'EOF'
ALTER TABLE "claude_sessions"
  DROP COLUMN IF EXISTS "slowestToolName",
  DROP COLUMN IF EXISTS "slowestToolMs";

CREATE TABLE IF NOT EXISTS "session_outlier_events" (
  "id"         TEXT NOT NULL,
  "sessionId"  TEXT NOT NULL,
  "projectId"  TEXT NOT NULL,
  "toolName"   TEXT NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "medianMs"   INTEGER NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "session_outlier_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "session_outlier_events"
  ADD CONSTRAINT "session_outlier_events_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "claude_sessions"("id")
    ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "session_outlier_events"
  ADD CONSTRAINT "session_outlier_events_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "session_outlier_events_projectId_toolName_idx"
  ON "session_outlier_events"("projectId", "toolName");

CREATE INDEX IF NOT EXISTS "session_outlier_events_sessionId_idx"
  ON "session_outlier_events"("sessionId");
EOF
```

Expected: `ALTER TABLE`, `CREATE TABLE`, `ALTER TABLE` × 2, `CREATE INDEX` × 2

**Step 6: Prisma migration history에 기록**

```bash
docker exec mytool-postgres psql -U mytool -d mytool -c "
  INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (gen_random_uuid(), 'manual', NOW(), '${TIMESTAMP}_add_outlier_event_log', NULL, NULL, NOW(), 1)
  ON CONFLICT DO NOTHING;"
```

**Step 7: API 서버 종료 후 Prisma client 재생성**

```bash
# 3001 포트 프로세스 종료 (PowerShell)
netstat -ano | grep ":3001" | grep LISTEN
# PID 확인 후:
# PowerShell: Stop-Process -Id <PID> -Force

cd packages/api && npx prisma generate
```

Expected: `✔ Generated Prisma Client`

**Step 8: 타입 체크**

```bash
cd packages/api && npx tsc --noEmit
```

Expected: 오류 없음 (slowestTool 참조가 있으면 다음 Task에서 수정)

**Step 9: Commit**

```bash
git add packages/api/prisma/schema.prisma \
        packages/api/prisma/migrations/
git commit -m "feat: add SessionOutlierEvent table, remove slowestTool columns"
```

---

### Task 2: outlier.ts 수정 — 개별 이벤트 저장으로 변경

**Files:**
- Modify: `packages/api/src/lib/outlier.ts`

현재 `OutlierStats` 인터페이스에서 `slowestToolName`, `slowestToolMs`를 제거하고,
이상치 판정된 각 툴 호출을 `session_outlier_events`에 저장하도록 변경한다.

**Step 1: outlier.ts 전체를 아래 내용으로 교체**

```typescript
import { prisma } from "../db.js";

export interface OutlierStats {
  outlierCount: number;
  outlierRatio: number;
}

/**
 * 세션의 Pre/PostToolUse 페어를 조회해 이상치를 계산하고 개별 로그로 저장한다.
 * 기준: durationMs > median(모든 페어 소요시간) * 10
 * 멱등성: 기존 outlier 이벤트를 삭제 후 재삽입
 */
export async function computeSessionOutlierStats(
  sessionId: string,
  projectId: string,
): Promise<OutlierStats> {
  const [preEvents, postEvents] = await Promise.all([
    prisma.event.findMany({
      where: { sessionId, hookEventName: "PreToolUse" },
      select: { id: true, toolName: true, timestamp: true },
      orderBy: { timestamp: "asc" },
    }),
    prisma.event.findMany({
      where: { sessionId, hookEventName: "PostToolUse" },
      select: { timestamp: true },
      orderBy: { timestamp: "asc" },
    }),
  ]);

  if (preEvents.length === 0) {
    return { outlierCount: 0, outlierRatio: 0 };
  }

  const usedPostIndices = new Set<number>();
  const pairs: { toolName: string | null; durationMs: number }[] = [];

  for (const pre of preEvents) {
    const preTime = pre.timestamp.getTime();
    for (let i = 0; i < postEvents.length; i++) {
      if (usedPostIndices.has(i)) continue;
      const postTime = postEvents[i]!.timestamp.getTime();
      if (postTime >= preTime) {
        pairs.push({ toolName: pre.toolName, durationMs: postTime - preTime });
        usedPostIndices.add(i);
        break;
      }
    }
  }

  if (pairs.length === 0) {
    return { outlierCount: 0, outlierRatio: 0 };
  }

  const sorted = [...pairs].sort((a, b) => a.durationMs - b.durationMs);
  const medianMs = sorted[Math.floor(sorted.length / 2)]?.durationMs ?? 1;
  const threshold = medianMs * 10;

  const outliers = pairs.filter((p) => p.durationMs > threshold);

  // 멱등성: 기존 레코드 삭제 후 재삽입
  await prisma.sessionOutlierEvent.deleteMany({ where: { sessionId } });

  if (outliers.length > 0) {
    await prisma.sessionOutlierEvent.createMany({
      data: outliers.map((o) => ({
        sessionId,
        projectId,
        toolName: o.toolName ?? "unknown",
        durationMs: o.durationMs,
        medianMs,
      })),
    });
  }

  return {
    outlierCount: outliers.length,
    outlierRatio: outliers.length / pairs.length,
  };
}
```

**Step 2: 타입 체크**

```bash
cd packages/api && npx tsc --noEmit
```

Expected: 오류 없음

**Step 3: Commit**

```bash
git add packages/api/src/lib/outlier.ts
git commit -m "feat: save per-tool outlier events instead of session summary"
```

---

### Task 3: events.ts 수정 — projectId 전달, slowestTool 필드 제거

**Files:**
- Modify: `packages/api/src/routes/events.ts`

**Step 1: computeSessionOutlierStats 호출부 수정**

`events.ts`에서 `computeSessionOutlierStats` 호출 시 `projectId` 인자를 추가하고,
`claudeSession.update`에서 `slowestToolName`, `slowestToolMs` 두 필드를 제거한다.

현재 코드 (`events.ts` Stop 처리 블록):

```typescript
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
```

변경 후:

```typescript
      computeSessionOutlierStats(event.sessionId, event.projectId)
        .then((stats) =>
          prisma.claudeSession.update({
            where: { id: event.sessionId },
            data: {
              outlierCount: stats.outlierCount,
              outlierRatio: stats.outlierRatio,
            },
          }),
        )
```

**Step 2: 타입 체크**

```bash
cd packages/api && npx tsc --noEmit
```

Expected: 오류 없음

**Step 3: Commit**

```bash
git add packages/api/src/routes/events.ts
git commit -m "fix: pass projectId to outlier stats, remove slowestTool fields"
```

---

### Task 4: dashboard.ts 수정 — slowestTool 필드 제거 + 크로스-세션 집계 추가

**Files:**
- Modify: `packages/api/src/routes/dashboard.ts`

**Step 1: 세션 목록/상세 응답에서 slowestTool 필드 제거**

`dashboard/sessions` 응답 map과 `sessions/:sessionId` 응답 객체에서
`slowestToolName`, `slowestToolMs` 두 필드를 삭제한다.

**Step 2: summary 엔드포인트에 툴별 이상치 집계 추가**

`dashboardRoute.get("/:projectId/dashboard/summary", ...)` 핸들러 안에서
기존 쿼리들과 함께 아래 쿼리를 추가한다:

```typescript
    const outliersByTool = await prisma.sessionOutlierEvent.groupBy({
      by: ["toolName"],
      where: { projectId, createdAt: { gte: from, lte: to } },
      _count: { id: true },
      _avg: { durationMs: true },
      _max: { durationMs: true },
    });
```

그리고 `return c.json(...)` 안에 아래 필드를 추가한다:

```typescript
      outliersByTool: outliersByTool.map((r) => ({
        toolName: r.toolName,
        occurrences: r._count.id,
        avgDurationMs: Math.round(r._avg.durationMs ?? 0),
        maxDurationMs: r._max.durationMs ?? 0,
      })),
```

**Step 3: 타입 체크**

```bash
cd packages/api && npx tsc --noEmit
```

Expected: 오류 없음

**Step 4: Commit**

```bash
git add packages/api/src/routes/dashboard.ts
git commit -m "feat: add cross-session outlier aggregation by tool to summary API"
```

---

### Task 5: 동작 검증

**Step 1: API 재빌드 및 재시작**

```bash
# 3001 포트 종료 후
cd packages/api && npm run build
cd ../.. && node packages/api/dist/index.js &
sleep 2 && curl -s http://localhost:3001/health
```

Expected: `{"status":"ok","db":"connected"}`

**Step 2: Stop 이벤트 전송**

```bash
TOKEN=$(cat ~/.mytool/config.json | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
curl -s -X POST http://localhost:3001/api/events \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectId\": \"cmoh132hr0001v8jkxnjpsdve\",
    \"sessionId\": \"e61c40ea-b3cc-44a7-a556-f558794ab138\",
    \"hookEventName\": \"Stop\",
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"
  }"
```

Expected: `{"ok":true}`

**Step 3: session_outlier_events 테이블 직접 확인**

```bash
sleep 2
docker exec mytool-postgres psql -U mytool -d mytool \
  -c "SELECT \"toolName\", \"durationMs\", \"medianMs\" FROM session_outlier_events LIMIT 10;"
```

Expected: toolName, durationMs, medianMs 컬럼이 있는 행들

**Step 4: summary API에서 크로스-세션 집계 확인**

```bash
TOKEN=$(cat ~/.mytool/config.json | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/projects/cmoh132hr0001v8jkxnjpsdve/dashboard/summary" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d.get('outliersByTool', []), indent=2, ensure_ascii=False))"
```

Expected: `[{"toolName": "PowerShell", "occurrences": N, "avgDurationMs": N, "maxDurationMs": N}, ...]`
