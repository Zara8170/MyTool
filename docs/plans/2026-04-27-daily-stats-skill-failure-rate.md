# Daily Stats Pre-aggregation & Skill Failure Rate Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 사전 집계 통계 테이블로 대시보드 쿼리 속도를 개선하고, 스킬/에이전트별 실패율을 추적한다.

**Architecture:** `DailyProjectStats` 테이블에 일별 집계를 저장해 Overview/Usage API가 전체 테이블 스캔 대신 pre-aggregated 데이터를 읽도록 한다. 스킬 실패율은 이미 저장된 `exitCode` 필드를 집계해 `topSkills` 응답에 포함시킨다. 오늘 날짜 데이터는 실시간으로 계산한다.

**Tech Stack:** Prisma (PostgreSQL), Hono, TypeScript, Next.js

**현재 한계:**
- `dashboard/summary`와 `dashboard/usage`는 매 요청마다 수십만 건 이벤트/usage 레코드를 집계 → 사용자 증가 시 느려짐
- 스킬 실패율이 없어 "이 스킬이 자주 실패하는지" 알 수 없음

---

### Task 1: Schema — DailyProjectStats 테이블 추가

**Files:**
- Modify: `packages/api/prisma/schema.prisma`

**Step 1: Project 모델에 relation 추가**

```prisma
  dailyStats DailyProjectStats[]
```

**Step 2: DailyProjectStats 모델 추가** (Message 모델 바로 앞에)

```prisma
model DailyProjectStats {
  id                       String   @id @default(cuid())
  projectId                String
  date                     DateTime @db.Date  // 날짜 (시각 제거, UTC 기준)

  sessionCount             Int      @default(0)
  activeUsers              Int      @default(0)
  inputTokens              BigInt   @default(0)
  outputTokens             BigInt   @default(0)
  cacheReadTokens          BigInt   @default(0)
  cacheCreationTokens      BigInt   @default(0)
  estimatedCostUsd         Decimal  @default(0) @db.Decimal(14, 6)

  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, date])
  @@index([projectId, date])
  @@map("daily_project_stats")
}
```

**Step 3: 마이그레이션 적용**

```bash
docker exec mytool-postgres psql -U mytool -d mytool << 'EOF'
CREATE TABLE IF NOT EXISTS "daily_project_stats" (
  "id"                  TEXT NOT NULL,
  "projectId"           TEXT NOT NULL,
  "date"                DATE NOT NULL,
  "sessionCount"        INTEGER NOT NULL DEFAULT 0,
  "activeUsers"         INTEGER NOT NULL DEFAULT 0,
  "inputTokens"         BIGINT NOT NULL DEFAULT 0,
  "outputTokens"        BIGINT NOT NULL DEFAULT 0,
  "cacheReadTokens"     BIGINT NOT NULL DEFAULT 0,
  "cacheCreationTokens" BIGINT NOT NULL DEFAULT 0,
  "estimatedCostUsd"    DECIMAL(14,6) NOT NULL DEFAULT 0,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_project_stats_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "daily_project_stats"
  ADD CONSTRAINT IF NOT EXISTS "daily_project_stats_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON UPDATE CASCADE ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "daily_project_stats_projectId_date_key"
  ON "daily_project_stats"("projectId", "date");

CREATE INDEX IF NOT EXISTS "daily_project_stats_projectId_date_idx"
  ON "daily_project_stats"("projectId", "date");
EOF
```

**Step 4: Prisma migration history 등록 및 client 재생성**

```bash
TIMESTAMP=$(date -u +%Y%m%d%H%M%S)
mkdir -p "packages/api/prisma/migrations/${TIMESTAMP}_add_daily_project_stats"
# migration.sql 파일은 Step 3의 SQL 내용으로 작성

docker exec mytool-postgres psql -U mytool -d mytool -c "
  INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
  VALUES (gen_random_uuid(), 'manual', NOW(), '${TIMESTAMP}_add_daily_project_stats', NULL, NULL, NOW(), 1)
  ON CONFLICT DO NOTHING;"

# 3001 포트 프로세스 종료 후
cd packages/api && npx prisma generate
```

**Step 5: 타입 체크**

```bash
cd packages/api && npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add packages/api/prisma/schema.prisma packages/api/prisma/migrations/
git commit -m "feat: add DailyProjectStats table for pre-aggregated dashboard metrics"
```

---

### Task 2: lib/daily-stats.ts — 일별 집계 계산

**Files:**
- Create: `packages/api/src/lib/daily-stats.ts`

**Step 1: daily-stats.ts 작성**

```typescript
import { prisma } from "../db.js";

/**
 * 특정 날짜의 프로젝트 통계를 계산해 upsert한다.
 * Stop 이벤트 수신 시 해당 날짜(UTC)를 대상으로 비동기 호출된다.
 */
export async function upsertDailyProjectStats(
  projectId: string,
  date: Date,
): Promise<void> {
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const [sessionsResult, usageResult, activeUsersResult] = await Promise.all([
    prisma.claudeSession.count({
      where: {
        projectId,
        startedAt: { gte: dayStart, lt: dayEnd },
      },
    }),
    prisma.usageRecord.aggregate({
      where: {
        projectId,
        recordedAt: { gte: dayStart, lt: dayEnd },
      },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        cacheReadInputTokens: true,
        cacheCreationInputTokens: true,
        estimatedCostUsd: true,
      },
    }),
    prisma.event.findMany({
      where: {
        projectId,
        timestamp: { gte: dayStart, lt: dayEnd },
      },
      distinct: ["userId"],
      select: { userId: true },
    }),
  ]);

  const dateOnly = new Date(dayStart);

  await prisma.dailyProjectStats.upsert({
    where: { projectId_date: { projectId, date: dateOnly } },
    create: {
      projectId,
      date: dateOnly,
      sessionCount: sessionsResult,
      activeUsers: activeUsersResult.length,
      inputTokens: usageResult._sum.inputTokens ?? 0,
      outputTokens: usageResult._sum.outputTokens ?? 0,
      cacheReadTokens: usageResult._sum.cacheReadInputTokens ?? 0,
      cacheCreationTokens: usageResult._sum.cacheCreationInputTokens ?? 0,
      estimatedCostUsd: usageResult._sum.estimatedCostUsd ?? 0,
    },
    update: {
      sessionCount: sessionsResult,
      activeUsers: activeUsersResult.length,
      inputTokens: usageResult._sum.inputTokens ?? 0,
      outputTokens: usageResult._sum.outputTokens ?? 0,
      cacheReadTokens: usageResult._sum.cacheReadInputTokens ?? 0,
      cacheCreationTokens: usageResult._sum.cacheCreationInputTokens ?? 0,
      estimatedCostUsd: usageResult._sum.estimatedCostUsd ?? 0,
    },
  });
}
```

**Step 2: 타입 체크**

```bash
cd packages/api && npx tsc --noEmit
```

Expected: 오류 없음

**Step 3: Commit**

```bash
git add packages/api/src/lib/daily-stats.ts
git commit -m "feat: add upsertDailyProjectStats for per-day aggregation"
```

---

### Task 3: events.ts — Stop 이벤트에서 daily stats 트리거

**Files:**
- Modify: `packages/api/src/routes/events.ts`

**Step 1: import 추가**

```typescript
import { upsertDailyProjectStats } from "../lib/daily-stats.js";
```

**Step 2: Stop 이벤트 처리 블록에 추가** (baseline update 뒤에)

```typescript
      upsertDailyProjectStats(event.projectId, new Date(event.timestamp)).catch((err) => {
        console.warn("[daily-stats] update failed", { projectId: event.projectId, err });
      });
```

**Step 3: 타입 체크 및 Commit**

```bash
cd packages/api && npx tsc --noEmit
git add packages/api/src/routes/events.ts
git commit -m "feat: trigger daily stats upsert on Stop event"
```

---

### Task 4: dashboard.ts — usage 엔드포인트를 daily stats로 교체

**Files:**
- Modify: `packages/api/src/routes/dashboard.ts`

**Step 1: dashboard/usage 핸들러 교체**

기존 `usageRecord.findMany` + JS bucketing 로직 전체를 아래로 교체:

```typescript
dashboardRoute.get(
  "/:projectId/dashboard/usage",
  zValidator("query", QuerySchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const userId = c.get("userId");
    const { from, to } = await resolveDateRange(
      projectId,
      userId,
      c.req.valid("query"),
    );

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // 오늘 이전: daily_project_stats에서 읽기
    const dailyRows = await prisma.dailyProjectStats.findMany({
      where: {
        projectId,
        date: { gte: from, lt: today },
      },
      orderBy: { date: "asc" },
    });

    // 오늘: 실시간 집계
    const todayEnd = new Date(today);
    todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);
    const todayUsage =
      to >= today
        ? await prisma.usageRecord.aggregate({
            where: { projectId, recordedAt: { gte: today, lt: todayEnd } },
            _sum: {
              inputTokens: true,
              outputTokens: true,
              cacheReadInputTokens: true,
              cacheCreationInputTokens: true,
              estimatedCostUsd: true,
            },
          })
        : null;

    const series = [
      ...dailyRows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        inputTokens: Number(r.inputTokens),
        outputTokens: Number(r.outputTokens),
        cacheReadTokens: Number(r.cacheReadTokens),
        cacheCreationTokens: Number(r.cacheCreationTokens),
        estimatedCostUsd:
          Math.round(Number(r.estimatedCostUsd) * 1_000_000) / 1_000_000,
      })),
      ...(todayUsage
        ? [
            {
              date: today.toISOString().slice(0, 10),
              inputTokens: todayUsage._sum.inputTokens ?? 0,
              outputTokens: todayUsage._sum.outputTokens ?? 0,
              cacheReadTokens: todayUsage._sum.cacheReadInputTokens ?? 0,
              cacheCreationTokens:
                todayUsage._sum.cacheCreationInputTokens ?? 0,
              estimatedCostUsd:
                Math.round(
                  Number(todayUsage._sum.estimatedCostUsd ?? 0) * 1_000_000,
                ) / 1_000_000,
            },
          ]
        : []),
    ];

    return c.json({ series });
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
git commit -m "perf: use daily_project_stats for usage API, real-time for today only"
```

---

### Task 5: 스킬 실패율 — API + 공유 타입 + UI

**Files:**
- Modify: `packages/api/src/routes/dashboard.ts`
- Modify: `packages/shared/src/schemas/dashboard.ts`
- Modify: `packages/web/src/app/dashboard/[projectId]/skills/page.tsx` (현재 파일 확인 필요)

**Step 1: shared schema 수정**

`DashboardSummarySchema`의 `topSkills` 배열 항목에 필드 추가:

```typescript
  topSkills: z.array(
    z.object({
      skillName: z.string(),
      callCount: z.number().int(),
      failedCount: z.number().int(),   // exitCode != 0 인 호출 수
      failureRate: z.number(),         // 0.0 ~ 1.0
    }),
  ),
```

**Step 2: dashboard.ts summary 엔드포인트에서 실패율 계산**

`topSkillsRaw` 쿼리를 아래로 교체:

```typescript
        prisma.event.groupBy({
          by: ["skillName"],
          where: {
            projectId,
            timestamp: { gte: from, lte: to },
            isSkillCall: true,
            skillName: { not: null },
            ...userFilter,
          },
          _count: { _all: true },
          orderBy: { _count: { skillName: "desc" } },
          take: 10,
        }),
```

→ 실패율 계산을 위해 groupBy 외에 추가 쿼리:

```typescript
        // topSkillsRaw는 그대로 유지
        prisma.event.groupBy({
          by: ["skillName"],
          where: {
            projectId,
            timestamp: { gte: from, lte: to },
            isSkillCall: true,
            skillName: { not: null },
            exitCode: { not: null, not: 0 },  // 실패한 호출만
            ...userFilter,
          },
          _count: { _all: true },
        }),
```

`Promise.all` 배열에 이 쿼리를 추가하고 `topSkillFailsRaw`로 받은 후, topSkills 응답 구성 시 병합:

```typescript
      const failMap = new Map(
        topSkillFailsRaw
          .filter((r) => r.skillName)
          .map((r) => [r.skillName!, r._count._all]),
      );

      topSkills: topSkillsRaw
        .filter((r) => r.skillName)
        .map((r) => {
          const total = r._count._all;
          const failed = failMap.get(r.skillName!) ?? 0;
          return {
            skillName: r.skillName!,
            callCount: total,
            failedCount: failed,
            failureRate: total > 0 ? failed / total : 0,
          };
        }),
```

**Step 3: Skills 페이지 UI 수정**

`packages/web/src/app/dashboard/[projectId]/skills/page.tsx`의 스킬 목록에 실패율 컬럼 추가:

```tsx
{summary.topSkills.map((s) => (
  <li key={s.skillName} className="flex justify-between text-sm ...">
    <span className="font-mono">{s.skillName}</span>
    <div className="flex gap-4 text-right">
      <span className="text-muted">{s.callCount.toLocaleString()}회</span>
      {s.failedCount > 0 ? (
        <span className="text-red-400">
          실패 {(s.failureRate * 100).toFixed(0)}%
        </span>
      ) : (
        <span className="text-green-600 text-xs">✓</span>
      )}
    </div>
  </li>
))}
```

**Step 4: 타입 체크**

```bash
cd packages/shared && npm run build
cd packages/api && npx tsc --noEmit
cd packages/web && npx tsc --noEmit
```

Expected: 오류 없음

**Step 5: Commit**

```bash
git add packages/api/src/routes/dashboard.ts \
        packages/shared/src/schemas/dashboard.ts \
        packages/web/src/app/dashboard/\[projectId\]/skills/page.tsx
git commit -m "feat: add skill failure rate to summary API and Skills page"
```

---

### Task 6: 동작 검증

**Step 1: API 재빌드 및 재시작**

```bash
# 3001 포트 프로세스 종료 후
cd packages/api && npm run build && cd ../.. && node packages/api/dist/index.js &
sleep 2 && curl -s http://localhost:3001/health
```

**Step 2: Stop 이벤트 전송 후 daily_project_stats 확인**

```bash
TOKEN=$(cat ~/.mytool/config.json | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
curl -s -X POST http://localhost:3001/api/events \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"cmoh132hr0001v8jkxnjpsdve\",\"sessionId\":\"e61c40ea-b3cc-44a7-a556-f558794ab138\",\"hookEventName\":\"Stop\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"}"

sleep 2
docker exec mytool-postgres psql -U mytool -d mytool \
  -c 'SELECT date, "sessionCount", "activeUsers", "inputTokens" FROM daily_project_stats ORDER BY date DESC LIMIT 5;'
```

Expected: 오늘 날짜 행이 존재

**Step 3: Usage API 응답 확인**

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/projects/cmoh132hr0001v8jkxnjpsdve/dashboard/usage" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['series']), 'days')"
```

Expected: 날짜 수가 출력됨

**Step 4: Summary API에서 실패율 확인**

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/projects/cmoh132hr0001v8jkxnjpsdve/dashboard/summary" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d['topSkills'], indent=2))"
```

Expected: `failureRate`, `failedCount` 필드 포함
