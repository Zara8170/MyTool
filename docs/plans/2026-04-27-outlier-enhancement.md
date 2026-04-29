# Outlier Detection Enhancement Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 세션 내 샘플 부족 문제를 해결하고 프로젝트 전체 기준선과 비교해 이상치를 더 정확하게 탐지한다.

**Architecture:** `ProjectToolBaseline` 테이블에 툴별 p50/p95를 주기적으로 계산해 저장한다. 세션 내 동일 툴 호출이 3개 미만일 때는 세션 기준 대신 프로젝트 기준선을 fallback으로 사용한다. 세션 상세 페이지에 "프로젝트 기준 대비 X.X배" 표시를 추가한다.

**Tech Stack:** Prisma (PostgreSQL), Hono, TypeScript, Next.js

**현재 한계:**
- 세션에서 같은 툴 호출이 3개 미만이면 이상치 판정 불가 (PowerShell 자주 스킵됨)
- 세션마다 기준선이 달라 "이게 프로젝트 전체 기준으로 봤을 때도 느린 건지" 알 수 없음
- 이상치 발생 추이 (주별, 일별)를 볼 수 없음

---

### Task 1: Schema — ProjectToolBaseline 테이블 추가

**Files:**
- Modify: `packages/api/prisma/schema.prisma`

**Step 1: Project 모델에 relation 추가**

`Project` 모델 relation 목록 끝에 추가:
```prisma
  toolBaselines ProjectToolBaseline[]
```

**Step 2: ProjectToolBaseline 모델 추가** (`SessionOutlierEvent` 바로 아래에)

```prisma
model ProjectToolBaseline {
  id          String   @id @default(cuid())
  projectId   String
  toolName    String
  p50Ms       Int      // 중앙값 (ms)
  p95Ms       Int      // 95th percentile (ms)
  sampleCount Int      // 집계에 사용된 페어 수
  updatedAt   DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, toolName])
  @@index([projectId])
  @@map("project_tool_baselines")
}
```

**Step 3: 마이그레이션 SQL 파일 생성**

```bash
TIMESTAMP=$(date -u +%Y%m%d%H%M%S)
mkdir -p "packages/api/prisma/migrations/${TIMESTAMP}_add_project_tool_baseline"
```

`migration.sql` 내용:
```sql
CREATE TABLE "project_tool_baselines" (
  "id"          TEXT NOT NULL,
  "projectId"   TEXT NOT NULL,
  "toolName"    TEXT NOT NULL,
  "p50Ms"       INTEGER NOT NULL,
  "p95Ms"       INTEGER NOT NULL,
  "sampleCount" INTEGER NOT NULL,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_tool_baselines_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "project_tool_baselines"
  ADD CONSTRAINT "project_tool_baselines_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON UPDATE CASCADE ON DELETE CASCADE;

CREATE UNIQUE INDEX "project_tool_baselines_projectId_toolName_key"
  ON "project_tool_baselines"("projectId", "toolName");

CREATE INDEX "project_tool_baselines_projectId_idx"
  ON "project_tool_baselines"("projectId");
```

**Step 4: 마이그레이션 적용**

```bash
docker exec mytool-postgres psql -U mytool -d mytool \
  -f /dev/stdin << 'EOF'
CREATE TABLE IF NOT EXISTS "project_tool_baselines" (
  "id"          TEXT NOT NULL,
  "projectId"   TEXT NOT NULL,
  "toolName"    TEXT NOT NULL,
  "p50Ms"       INTEGER NOT NULL,
  "p95Ms"       INTEGER NOT NULL,
  "sampleCount" INTEGER NOT NULL,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "project_tool_baselines_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "project_tool_baselines"
  ADD CONSTRAINT IF NOT EXISTS "project_tool_baselines_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON UPDATE CASCADE ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "project_tool_baselines_projectId_toolName_key"
  ON "project_tool_baselines"("projectId", "toolName");

CREATE INDEX IF NOT EXISTS "project_tool_baselines_projectId_idx"
  ON "project_tool_baselines"("projectId");
EOF
```

**Step 5: Prisma migration history 등록**

```bash
TIMESTAMP=<위에서 사용한 TIMESTAMP>
docker exec mytool-postgres psql -U mytool -d mytool -c "
  INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (gen_random_uuid(), 'manual', NOW(), '${TIMESTAMP}_add_project_tool_baseline', NULL, NULL, NOW(), 1)
  ON CONFLICT DO NOTHING;"
```

**Step 6: Prisma client 재생성** (3001 포트 프로세스 종료 후)

```bash
cd packages/api && npx prisma generate
```

Expected: `✔ Generated Prisma Client`

**Step 7: 타입 체크**

```bash
cd packages/api && npx tsc --noEmit
```

Expected: 오류 없음

**Step 8: Commit**

```bash
git add packages/api/prisma/schema.prisma packages/api/prisma/migrations/
git commit -m "feat: add ProjectToolBaseline table for cross-session outlier baseline"
```

---

### Task 2: lib/baseline.ts — 프로젝트 기준선 계산

**Files:**
- Create: `packages/api/src/lib/baseline.ts`

**Step 1: baseline.ts 작성**

```typescript
import { prisma } from "../db.js";

const EXCLUDED_TOOLS = new Set(["Agent"]);
const MIN_SAMPLES = 10; // 프로젝트 기준선은 더 많은 샘플 요구

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

/**
 * 프로젝트의 최근 90일 세션을 기반으로 툴별 p50/p95를 계산해 저장한다.
 * Stop 이벤트 수신 시 비동기로 호출된다.
 */
export async function updateProjectToolBaselines(
  projectId: string,
): Promise<void> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const [preEvents, postEvents] = await Promise.all([
    prisma.event.findMany({
      where: {
        projectId,
        hookEventName: "PreToolUse",
        timestamp: { gte: since },
        toolName: { notIn: [...EXCLUDED_TOOLS] },
      },
      select: { toolName: true, timestamp: true, sessionId: true },
      orderBy: { timestamp: "asc" },
    }),
    prisma.event.findMany({
      where: {
        projectId,
        hookEventName: "PostToolUse",
        timestamp: { gte: since },
        toolName: { notIn: [...EXCLUDED_TOOLS] },
      },
      select: { toolName: true, timestamp: true, sessionId: true },
      orderBy: { timestamp: "asc" },
    }),
  ]);

  // 세션+툴별 버킷으로 매칭
  const postBuckets = new Map<string, { timestamp: Date }[]>();
  for (const post of postEvents) {
    const key = `${post.sessionId}__${post.toolName ?? "__none__"}`;
    if (!postBuckets.has(key)) postBuckets.set(key, []);
    postBuckets.get(key)!.push(post);
  }

  const usedIndices = new Map<string, Set<number>>();
  const toolDurations = new Map<string, number[]>();

  for (const pre of preEvents) {
    const bucketKey = `${pre.sessionId}__${pre.toolName ?? "__none__"}`;
    const bucket = postBuckets.get(bucketKey) ?? [];
    if (!usedIndices.has(bucketKey)) usedIndices.set(bucketKey, new Set());
    const used = usedIndices.get(bucketKey)!;
    const preTime = pre.timestamp.getTime();

    for (let i = 0; i < bucket.length; i++) {
      if (used.has(i)) continue;
      const postTime = bucket[i]!.timestamp.getTime();
      if (postTime >= preTime) {
        const toolKey = pre.toolName ?? "__none__";
        if (!toolDurations.has(toolKey)) toolDurations.set(toolKey, []);
        toolDurations.get(toolKey)!.push(postTime - preTime);
        used.add(i);
        break;
      }
    }
  }

  for (const [toolName, durations] of toolDurations) {
    if (durations.length < MIN_SAMPLES) continue;
    const sorted = [...durations].sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);

    await prisma.projectToolBaseline.upsert({
      where: { projectId_toolName: { projectId, toolName } },
      create: {
        projectId,
        toolName,
        p50Ms: p50,
        p95Ms: p95,
        sampleCount: durations.length,
      },
      update: {
        p50Ms: p50,
        p95Ms: p95,
        sampleCount: durations.length,
      },
    });
  }
}
```

**Step 2: 타입 체크**

```bash
cd packages/api && npx tsc --noEmit
```

Expected: 오류 없음

**Step 3: Commit**

```bash
git add packages/api/src/lib/baseline.ts
git commit -m "feat: add updateProjectToolBaselines to compute project-level p50/p95 per tool"
```

---

### Task 3: events.ts — Stop 이벤트에서 기준선 업데이트 트리거

**Files:**
- Modify: `packages/api/src/routes/events.ts`

**Step 1: import 추가**

파일 상단 imports에 추가:
```typescript
import { updateProjectToolBaselines } from "../lib/baseline.js";
```

**Step 2: Stop 이벤트 처리 블록 수정**

기존 outlier 계산 블록 뒤에 baseline 업데이트 추가:

```typescript
    if (
      event.hookEventName === "Stop" ||
      event.hookEventName === "SubagentStop"
    ) {
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
        .catch((err) => {
          console.warn("[outlier] aggregation failed", { sessionId: event.sessionId, err });
        });

      // 프로젝트 기준선 업데이트 (별도 비동기, 실패해도 무관)
      updateProjectToolBaselines(event.projectId).catch((err) => {
        console.warn("[baseline] update failed", { projectId: event.projectId, err });
      });
    }
```

**Step 3: 타입 체크**

```bash
cd packages/api && npx tsc --noEmit
```

Expected: 오류 없음

**Step 4: Commit**

```bash
git add packages/api/src/routes/events.ts
git commit -m "feat: trigger project tool baseline update on Stop event"
```

---

### Task 4: outlier.ts — 세션 샘플 부족 시 프로젝트 기준선 fallback

**Files:**
- Modify: `packages/api/src/lib/outlier.ts`

**Step 1: 기준선 조회 후 fallback 적용**

`computeSessionOutlierStats` 함수에서 `toolGroups` 처리 부분을 아래로 교체:

```typescript
  // 프로젝트 기준선 조회 (MIN_SAMPLES 미달 툴에 fallback으로 사용)
  const projectBaselines = await prisma.projectToolBaseline.findMany({
    where: { projectId },
    select: { toolName: true, p50Ms: true },
  });
  const baselineMap = new Map(projectBaselines.map((b) => [b.toolName, b.p50Ms]));

  const outliers: { toolName: string | null; durationMs: number; medianMs: number }[] = [];
  let eligiblePairs = 0;

  for (const [toolName, group] of toolGroups) {
    let medianMs: number;

    if (group.length >= MIN_SAMPLES) {
      // 세션 내 충분한 샘플 → 세션 기준 중앙값
      const sorted = [...group].sort((a, b) => a.durationMs - b.durationMs);
      medianMs = sorted[Math.floor(sorted.length / 2)]!.durationMs;
    } else {
      // 샘플 부족 → 프로젝트 기준선 fallback
      const baseline = baselineMap.get(toolName ?? "__none__");
      if (!baseline) continue; // 기준선도 없으면 스킵
      medianMs = baseline;
    }

    eligiblePairs += group.length;
    const threshold = medianMs * 10;

    for (const pair of group) {
      if (pair.durationMs > threshold) {
        outliers.push({ ...pair, medianMs });
      }
    }
  }
```

**Step 2: 타입 체크**

```bash
cd packages/api && npx tsc --noEmit
```

Expected: 오류 없음

**Step 3: 동작 검증** — Stop 이벤트 전송 후 DB 확인

```bash
TOKEN=$(cat ~/.mytool/config.json | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
curl -s -X POST http://localhost:3001/api/events \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"cmoh132hr0001v8jkxnjpsdve\",\"sessionId\":\"e61c40ea-b3cc-44a7-a556-f558794ab138\",\"hookEventName\":\"Stop\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"}"

sleep 3
docker exec mytool-postgres psql -U mytool -d mytool \
  -c 'SELECT "toolName", "p50Ms", "p95Ms", "sampleCount" FROM project_tool_baselines;'
```

Expected: toolName별 p50/p95 행이 출력됨

**Step 4: Commit**

```bash
git add packages/api/src/lib/outlier.ts
git commit -m "feat: fallback to project baseline when session has < 3 samples per tool"
```

---

### Task 5: 세션 상세 — "프로젝트 기준 대비" 표시

**Files:**
- Modify: `packages/api/src/routes/dashboard.ts`
- Modify: `packages/shared/src/schemas/dashboard.ts`
- Modify: `packages/web/src/app/dashboard/[projectId]/sessions/[sessionId]/page.tsx`

**Step 1: SessionDetail 응답에 baselineComparison 추가**

`packages/shared/src/schemas/dashboard.ts`의 `SessionDetailSchema`에 추가:
```typescript
  baselineComparison: z.array(z.object({
    toolName: z.string(),
    sessionMedianMs: z.number().int(),
    projectP50Ms: z.number().int(),
    ratio: z.number(), // sessionMedian / projectP50
  })).optional(),
```

**Step 2: dashboard.ts의 세션 상세 엔드포인트에 비교 데이터 추가**

`GET /:projectId/sessions/:sessionId` 핸들러에서 기존 session 조회 후:

```typescript
  // 프로젝트 기준선 조회
  const baselines = await prisma.projectToolBaseline.findMany({
    where: { projectId },
    select: { toolName: true, p50Ms: true },
  });
  const baselineMap = new Map(baselines.map((b) => [b.toolName, b.p50Ms]));

  // 세션 내 툴별 중앙값 계산 (outlier_events 활용)
  const sessionOutliers = await prisma.sessionOutlierEvent.findMany({
    where: { sessionId },
    select: { toolName: true, medianMs: true },
  });
  const sessionMedians = new Map<string, number>();
  for (const o of sessionOutliers) {
    if (!sessionMedians.has(o.toolName)) {
      sessionMedians.set(o.toolName, o.medianMs);
    }
  }

  const baselineComparison = [...sessionMedians.entries()]
    .filter(([toolName]) => baselineMap.has(toolName))
    .map(([toolName, sessionMedianMs]) => ({
      toolName,
      sessionMedianMs,
      projectP50Ms: baselineMap.get(toolName)!,
      ratio: Math.round((sessionMedianMs / baselineMap.get(toolName)!) * 10) / 10,
    }))
    .filter((b) => b.ratio > 1.5) // 1.5배 이상 차이만 표시
    .sort((a, b) => b.ratio - a.ratio);
```

`return c.json(...)` 안에 `baselineComparison` 추가.

**Step 3: 세션 상세 페이지 UI 추가**

요약 카드 섹션 바로 아래, 토큰 breakdown 위에 조건부 렌더링 추가:

```tsx
{session.baselineComparison && session.baselineComparison.length > 0 && (
  <section className="bg-amber-950/20 border border-amber-900/40 rounded-lg p-4">
    <h2 className="text-sm font-semibold text-amber-400 mb-2">
      ⚠ 프로젝트 기준 대비 느린 툴
    </h2>
    <ul className="space-y-1">
      {session.baselineComparison.map((b) => (
        <li key={b.toolName} className="text-sm flex justify-between">
          <span className="font-mono">{b.toolName}</span>
          <span className="text-amber-400">
            {b.ratio}x 느림
            <span className="text-muted ml-2 text-xs">
              ({formatMs(b.sessionMedianMs)} vs 기준 {formatMs(b.projectP50Ms)})
            </span>
          </span>
        </li>
      ))}
    </ul>
  </section>
)}
```

**Step 4: 타입 체크**

```bash
cd packages/api && npx tsc --noEmit
cd packages/web && npx tsc --noEmit
```

Expected: 오류 없음

**Step 5: Commit**

```bash
git add packages/api/src/routes/dashboard.ts \
        packages/shared/src/schemas/dashboard.ts \
        packages/web/src/app/dashboard/\[projectId\]/sessions/\[sessionId\]/page.tsx
git commit -m "feat: show session vs project baseline comparison in session detail"
```
