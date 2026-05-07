# Outlier Removal, Forgotten Skills, Today Cache — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the unused outlier/baseline detection system, add per-user "forgotten skills" detection (skills used in past 4 weeks but not in the past 7 days), and add a 30-second in-memory cache for today's usage aggregate.

**Architecture:** Outlier removal spans DB schema, two API packages, and four UI files. Forgotten skills requires one new API endpoint and one new web route + server query + UI section. Today cache is a module-level Map with TTL in server-queries.ts.

**Tech Stack:** Hono (API), Next.js App Router (web), Prisma + PostgreSQL, TypeScript, Tailwind CSS.

---

### Task 1: Remove outlier/baseline from Prisma schema

**Files:**
- Modify: `packages/api/prisma/schema.prisma`

**Step 1: Edit schema.prisma**

Remove from `Project` model (lines ~117-118):
```diff
-  outlierEvents SessionOutlierEvent[]
-  toolBaselines ProjectToolBaseline[]
```

Remove from `ClaudeSession` model (lines ~134-135, ~139):
```diff
-  // Stop 이벤트 수신 시 서버에서 집계
-  outlierCount    Int?    // 이상치 툴 호출 횟수
-  outlierRatio    Float?  // 이상치 비율 (0.0–1.0)
-
-  outlierEvents SessionOutlierEvent[]
```

Remove the entire `SessionOutlierEvent` model (~lines 151-166) and `ProjectToolBaseline` model (~lines 168-182).

**Step 2: Create and apply migration**

```bash
cd packages/api
npx prisma migrate dev --name remove_outlier_baseline
```

Expected: migration created and applied, `session_outlier_events` and `project_tool_baselines` tables dropped, `outlier_count`/`outlier_ratio` columns dropped from `claude_sessions`.

**Step 3: Verify**

```bash
npx prisma studio
```

Confirm `SessionOutlierEvent` and `ProjectToolBaseline` no longer appear, and `ClaudeSession` has no `outlierCount`/`outlierRatio` fields.

**Step 4: Commit**

```bash
git add packages/api/prisma/schema.prisma packages/api/prisma/migrations/
git commit -m "chore: remove outlier and baseline DB schema"
```

---

### Task 2: Remove outlier/baseline from API package

**Files:**
- Delete: `packages/api/src/lib/outlier.ts`
- Delete: `packages/api/src/lib/baseline.ts`
- Modify: `packages/api/src/routes/events.ts`
- Modify: `packages/api/src/routes/dashboard.ts`

**Step 1: Delete the lib files**

```bash
rm packages/api/src/lib/outlier.ts
rm packages/api/src/lib/baseline.ts
```

**Step 2: Edit packages/api/src/routes/events.ts**

Remove imports (lines 13-14):
```diff
-import { computeSessionOutlierStats } from "../lib/outlier.js";
-import { updateProjectToolBaselines } from "../lib/baseline.js";
```

Remove the outlier/baseline async calls in the Stop handler (lines 148-169). Keep `upsertDailyProjectStats`. The block becomes:

```typescript
    if (
      event.hookEventName === "Stop" ||
      event.hookEventName === "SubagentStop"
    ) {
      upsertDailyProjectStats(event.projectId, new Date(event.timestamp)).catch((err) => {
        console.warn("[daily-stats] update failed", { projectId: event.projectId, err });
      });
    }
```

**Step 3: Edit packages/api/src/routes/dashboard.ts**

In the `GET /summary` handler, remove:
- The `outlierSessionFilter` block (lines ~120-131)
- The `outliersByToolRaw` query (lines ~133-139)
- `outliersByTool` from the return value (lines ~171-177)

In the `GET /sessions/:sessionId` handler, remove:
- The `const [baselines, sessionOutliers]` parallel query (lines ~346-355)
- `baselineMap`, `sessionMedians`, `baselineComparison` computations (lines ~357-374)
- `outlierCount`, `outlierRatio` from return (lines ~389-390)
- `baselineComparison` from return (line ~401)

In the `GET /sessions` handler, remove `outlierCount` and `outlierRatio` from the sessions map return (lines ~536-538).

**Step 4: Verify TypeScript compiles**

```bash
cd packages/api
npx tsc --noEmit
```

Expected: 0 errors.

**Step 5: Commit**

```bash
git add packages/api/src/routes/events.ts packages/api/src/routes/dashboard.ts
git commit -m "chore: remove outlier/baseline from API routes and lib"
```

---

### Task 3: Remove outlier/baseline from web package lib and API routes

**Files:**
- Delete: `packages/web/src/lib/outlier.ts`
- Delete: `packages/web/src/lib/baseline.ts`
- Modify: `packages/web/src/app/api/events/route.ts`
- Modify: `packages/web/src/app/api/projects/[projectId]/dashboard/summary/route.ts`
- Modify: `packages/web/src/app/api/projects/[projectId]/dashboard/sessions/route.ts`
- Modify: `packages/web/src/app/api/projects/[projectId]/sessions/[sessionId]/route.ts`

**Step 1: Delete web lib files**

```bash
rm packages/web/src/lib/outlier.ts
rm packages/web/src/lib/baseline.ts
```

**Step 2: Edit packages/web/src/app/api/events/route.ts**

Remove imports (lines 8-9):
```diff
-import { computeSessionOutlierStats } from "@/lib/outlier";
-import { updateProjectToolBaselines } from "@/lib/baseline";
```

Find the Stop/SubagentStop async block and remove the `computeSessionOutlierStats` and `updateProjectToolBaselines` calls, keeping only `upsertDailyProjectStats`. The exact pattern to find and remove:

```typescript
      computeSessionOutlierStats(event.sessionId, event.projectId)
        .then((stats) => ...)
        .catch(...);

      updateProjectToolBaselines(event.projectId).catch(...);
```

**Step 3: Edit summary route**

In `packages/web/src/app/api/projects/[projectId]/dashboard/summary/route.ts`:

Remove the `outlierSessionFilter` block (lines ~108-119), the `outliersByToolRaw` query (lines ~121-127), and `outliersByTool` from the return JSON (lines ~156-161).

**Step 4: Edit sessions route**

In `packages/web/src/app/api/projects/[projectId]/dashboard/sessions/route.ts`:

Remove `outlierCount` and `outlierRatio` from the sessions map return (lines ~89-91):
```diff
-          outlierCount: s.outlierCount,
-          outlierRatio: s.outlierRatio,
```

**Step 5: Edit session-detail route**

In `packages/web/src/app/api/projects/[projectId]/sessions/[sessionId]/route.ts`:

Remove the `const [baselines, sessionOutliers]` parallel query (lines ~84-93), all the `baselineMap`/`sessionMedians`/`baselineComparison` computation (lines ~95-110), and from the return JSON remove `outlierCount`, `outlierRatio`, `baselineComparison` (lines ~125-126, ~132).

**Step 6: Verify**

```bash
cd packages/web
npx tsc --noEmit
```

Expected: 0 errors.

**Step 7: Commit**

```bash
git add packages/web/src/lib/ packages/web/src/app/api/
git commit -m "chore: remove outlier/baseline from web lib and API routes"
```

---

### Task 4: Remove outlier from server-queries.ts

**Files:**
- Modify: `packages/web/src/lib/server-queries.ts`

**Step 1: Edit getDashboardSummary** (lines ~60-135)

Remove the `outliersByToolRaw` query (lines ~102-108) and the `outliersByTool` field from the return value (lines ~128-133).

**Step 2: Edit getSessionList** (lines ~180-216)

Remove `outlierCount` and `outlierRatio` from the sessions map return (lines ~212-213):
```diff
-        outlierCount: s.outlierCount, outlierRatio: s.outlierRatio,
```

**Step 3: Edit getSessionDetail** (lines ~219-285)

Remove the `const [baselines, sessionOutliers]` parallel query (lines ~250-253), all the `baselineMap`/`sessionMedians`/`baselineComparison` computation (lines ~255-269), and from the return object remove `outlierCount`, `outlierRatio`, `baselineComparison` (lines ~279, ~283-284).

**Step 4: Verify**

```bash
cd packages/web
npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add packages/web/src/lib/server-queries.ts
git commit -m "chore: remove outlier/baseline from server-queries"
```

---

### Task 5: Remove outlier from UI pages and components

**Files:**
- Modify: `packages/web/src/app/dashboard/[projectId]/page.tsx`
- Modify: `packages/web/src/app/dashboard/[projectId]/sessions/page.tsx`
- Modify: `packages/web/src/app/dashboard/[projectId]/sessions/[sessionId]/page.tsx`
- Modify: `packages/web/src/components/activity-ribbon.tsx`
- Modify: `packages/web/src/components/merged-event-list.tsx`
- Modify: `packages/web/src/components/session-gantt.tsx`

**Step 1: Edit dashboard overview page** (`page.tsx`)

Remove the entire "Slow tools" section (lines ~72-112):
```diff
-      {summary.outliersByTool.length > 0 && (
-        <section>
-          ...
-        </section>
-      )}
```

**Step 2: Edit sessions list page**

Remove the `<th>Outliers</th>` column header (line ~37) and the corresponding `<td>` cell (lines ~65-73).

**Step 3: Edit session detail page**

Remove:
- `const OUTLIER_EXCLUDED_TOOLS = new Set(["Agent"])` (line ~64)
- `const MIN_SAMPLES_FOR_OUTLIER = 3` (line ~99)
- The `perToolMedianThresholds` function (lines ~101-117)
- In `buildRibbonSegments`: remove `const thresholds = perToolMedianThresholds(pairs)` and set `isOutlier: false` always
- In `buildEventPairRows`: remove `const thresholds = perToolMedianThresholds(pairs)` and set `isOutlier: false` always
- The `baselineComparison` section JSX (lines ~271-291)

After editing, `buildRibbonSegments` becomes:
```typescript
function buildRibbonSegments(pairs: PairedResult[]): RibbonSegment[] {
  return pairs.map((p) => ({
    id: p.preId,
    label: toolLabel(p.pre),
    colorKey: colorKey(p.pre),
    durationMs: p.durationMs,
    isOutlier: false,
  }));
}
```

And `buildEventPairRows` — remove the `thresholds` lookup and set `isOutlier: false`:
```typescript
      isOutlier: false,
```

**Step 4: Edit activity-ribbon.tsx**

Remove the `isOutlier` field from `RibbonSegment` type (line ~10) and the outlier dot JSX (lines ~61-63) and the outlier tooltip span (line ~76).

`RibbonSegment` becomes:
```typescript
export type RibbonSegment = {
  id: string;
  label: string;
  colorKey: "read" | "bash" | "edit" | "skill" | "agent" | "other";
  durationMs: number;
};
```

**Step 5: Edit merged-event-list.tsx**

Remove `isOutlier` from `EventPairRow` type (line ~11). Remove `"outlier"` from the `FilterKey` type (line ~52) and from the `FILTERS` array (line ~56). Remove the `case "outlier": return row.isOutlier;` branch (line ~70). Remove the outlier badge JSX (lines ~171-174).

**Step 6: Edit session-gantt.tsx**

Remove the local outlier computation block (lines ~51-54) and the outlier warning JSX section (lines ~88-93):
```diff
-  const outliers = segments.filter((s) => s.durationMs > median * 20);
```
```diff
-      {outliers.length > 0 && (
-        <div ...>
-          ...
-        </div>
-      )}
```

Remove the `durations`/`median` variables too if they are only used for the outlier computation. Keep `sorted` only if used elsewhere (for display).

**Step 7: Verify**

```bash
cd packages/web
npx tsc --noEmit
```

Expected: 0 errors.

**Step 8: Commit**

```bash
git add packages/web/src/app/dashboard/ packages/web/src/components/
git commit -m "chore: remove outlier UI from pages and components"
```

---

### Task 6: Add forgotten-skills endpoint to API package

**Files:**
- Modify: `packages/api/src/routes/dashboard.ts`

**Step 1: Add the endpoint**

Append to `packages/api/src/routes/dashboard.ts` after the sessions list endpoint:

```typescript
/**
 * GET /api/projects/:projectId/dashboard/forgotten-skills
 * 
 * 쿼리 파라미터:
 *   userId (required): 조회할 사용자 ID
 *
 * 과거 28일 동안 사용한 스킬 중 최근 7일에 사용하지 않은 스킬 목록을 반환한다.
 */
dashboardRoute.get(
  "/:projectId/dashboard/forgotten-skills",
  zValidator("query", z.object({ userId: z.string() })),
  async (c) => {
    const projectId = c.req.param("projectId");
    const authUserId = c.get("userId");
    const { userId: targetUserId } = c.req.valid("query");

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project) throw notFound("Project not found");
    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId: authUserId, orgId: project.orgId } },
    });
    if (!membership) throw forbidden();

    const now = new Date();
    const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [pastSkillsRaw, recentSkillsRaw] = await Promise.all([
      prisma.event.findMany({
        where: {
          projectId,
          userId: targetUserId,
          isSkillCall: true,
          skillName: { not: null },
          timestamp: { gte: fourWeeksAgo },
        },
        select: { skillName: true, timestamp: true },
        orderBy: { timestamp: "desc" },
      }),
      prisma.event.findMany({
        where: {
          projectId,
          userId: targetUserId,
          isSkillCall: true,
          skillName: { not: null },
          timestamp: { gte: oneWeekAgo },
        },
        select: { skillName: true },
        distinct: ["skillName"],
      }),
    ]);

    const recentSkills = new Set(recentSkillsRaw.map((e) => e.skillName!));

    // 과거 4주 중 최근 사용일 계산 (이미 desc 정렬됨)
    const lastUsedMap = new Map<string, string>();
    for (const e of pastSkillsRaw) {
      if (!lastUsedMap.has(e.skillName!)) {
        lastUsedMap.set(e.skillName!, e.timestamp.toISOString());
      }
    }

    const forgottenSkills = [...lastUsedMap.entries()]
      .filter(([skillName]) => !recentSkills.has(skillName))
      .map(([skillName, lastUsedAt]) => ({ skillName, lastUsedAt }))
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));

    return c.json({ forgottenSkills });
  },
);
```

**Step 2: Verify**

```bash
cd packages/api
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add packages/api/src/routes/dashboard.ts
git commit -m "feat: add forgotten-skills endpoint to API"
```

---

### Task 7: Add forgotten-skills route and query to web package

**Files:**
- Create: `packages/web/src/app/api/projects/[projectId]/dashboard/forgotten-skills/route.ts`
- Modify: `packages/web/src/lib/server-queries.ts`

**Step 1: Create the web API proxy route**

Create `packages/web/src/app/api/projects/[projectId]/dashboard/forgotten-skills/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-auth";
import { handleRouteError, forbidden, notFound } from "@/lib/api-errors";

const QuerySchema = z.object({
  userId: z.string(),
});

export async function GET(
  req: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const { projectId } = await context.params;
    const url = new URL(req.url);
    const { userId: targetUserId } = QuerySchema.parse({
      userId: url.searchParams.get("userId"),
    });

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project) throw notFound("Project not found");
    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId: authUserId, orgId: project.orgId } },
    });
    if (!membership) throw forbidden();

    const now = new Date();
    const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [pastSkillsRaw, recentSkillsRaw] = await Promise.all([
      prisma.event.findMany({
        where: {
          projectId,
          userId: targetUserId,
          isSkillCall: true,
          skillName: { not: null },
          timestamp: { gte: fourWeeksAgo },
        },
        select: { skillName: true, timestamp: true },
        orderBy: { timestamp: "desc" },
      }),
      prisma.event.findMany({
        where: {
          projectId,
          userId: targetUserId,
          isSkillCall: true,
          skillName: { not: null },
          timestamp: { gte: oneWeekAgo },
        },
        select: { skillName: true },
        distinct: ["skillName"],
      }),
    ]);

    const recentSkills = new Set(recentSkillsRaw.map((e) => e.skillName!));

    const lastUsedMap = new Map<string, string>();
    for (const e of pastSkillsRaw) {
      if (!lastUsedMap.has(e.skillName!)) {
        lastUsedMap.set(e.skillName!, e.timestamp.toISOString());
      }
    }

    const forgottenSkills = [...lastUsedMap.entries()]
      .filter(([skillName]) => !recentSkills.has(skillName))
      .map(([skillName, lastUsedAt]) => ({ skillName, lastUsedAt }))
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));

    return NextResponse.json({ forgottenSkills });
  } catch (err) {
    return handleRouteError(err);
  }
}
```

**Step 2: Add getForgottenSkills to server-queries.ts**

Append to `packages/web/src/lib/server-queries.ts`:

```typescript
// Forgotten skills — used in past 28 days but not in past 7 days
export async function getForgottenSkills(projectId: string, userId: string, targetUserId: string) {
  await checkProjectAccess(projectId, userId);

  const now = new Date();
  const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [pastSkillsRaw, recentSkillsRaw] = await Promise.all([
    prisma.event.findMany({
      where: {
        projectId,
        userId: targetUserId,
        isSkillCall: true,
        skillName: { not: null },
        timestamp: { gte: fourWeeksAgo },
      },
      select: { skillName: true, timestamp: true },
      orderBy: { timestamp: "desc" },
    }),
    prisma.event.findMany({
      where: {
        projectId,
        userId: targetUserId,
        isSkillCall: true,
        skillName: { not: null },
        timestamp: { gte: oneWeekAgo },
      },
      select: { skillName: true },
      distinct: ["skillName"],
    }),
  ]);

  const recentSkills = new Set(recentSkillsRaw.map((e) => e.skillName!));

  const lastUsedMap = new Map<string, string>();
  for (const e of pastSkillsRaw) {
    if (!lastUsedMap.has(e.skillName!)) {
      lastUsedMap.set(e.skillName!, e.timestamp.toISOString());
    }
  }

  return [...lastUsedMap.entries()]
    .filter(([skillName]) => !recentSkills.has(skillName))
    .map(([skillName, lastUsedAt]) => ({ skillName, lastUsedAt }))
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
}
```

**Step 3: Verify**

```bash
cd packages/web
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add packages/web/src/app/api/projects/ packages/web/src/lib/server-queries.ts
git commit -m "feat: add forgotten-skills route and server query"
```

---

### Task 8: Add forgotten-skills UI to dashboard overview page

**Files:**
- Modify: `packages/web/src/app/dashboard/[projectId]/page.tsx`

**Step 1: Add import and data fetch**

Add `getForgottenSkills` import and fetch it in `OverviewPage`:

```typescript
import { getRequiredUserId, getDashboardSummary, getUsageSeries, getForgottenSkills } from "@/lib/server-queries";
```

In `OverviewPage`, change the data fetch to:
```typescript
  const [summary, usage, forgottenSkills] = await Promise.all([
    getDashboardSummary(projectId, userId),
    getUsageSeries(projectId, userId),
    getForgottenSkills(projectId, userId, userId),
  ]);
```

**Step 2: Add the UI section**

Add after the "Top skills / Top agent types" grid section:

```tsx
      {forgottenSkills.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-1">최근 1주일 동안 쓰지 않은 스킬</h2>
          <p className="text-xs text-muted mb-3">
            지난 4주 동안 사용했지만 최근 7일 동안 사용하지 않은 스킬입니다.
          </p>
          <div className="bg-panel border rounded-lg p-4">
            <ul className="space-y-1.5">
              {forgottenSkills.map((s) => (
                <li key={s.skillName} className="flex justify-between text-sm border-b last:border-b-0 pb-1.5 last:pb-0">
                  <span className="font-mono">{s.skillName}</span>
                  <span className="text-muted text-xs">
                    마지막 사용: {new Date(s.lastUsedAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
```

**Step 3: Verify TypeScript**

```bash
cd packages/web
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add packages/web/src/app/dashboard/
git commit -m "feat: add forgotten-skills section to dashboard overview"
```

---

### Task 9: Add 30-second today-usage cache

**Files:**
- Modify: `packages/web/src/lib/server-queries.ts`

**Step 1: Add cache to getUsageSeries**

At the top of `server-queries.ts` (after imports), add:

```typescript
// 30-second in-memory cache for today's usage aggregate.
// Keyed by projectId. Single-process server only.
const todayUsageCache = new Map<string, { data: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; estimatedCostUsd: number }; expiresAt: number }>();
const TODAY_CACHE_TTL_MS = 30_000;
```

In `getUsageSeries`, replace the today aggregate logic:

```typescript
  // 오늘 실시간 집계 — 30초 캐시
  const cacheKey = projectId;
  const cached = todayUsageCache.get(cacheKey);
  let todayData: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; estimatedCostUsd: number };

  if (cached && cached.expiresAt > Date.now()) {
    todayData = cached.data;
  } else {
    const todayEnd = new Date(today);
    todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);
    const todayUsage = await prisma.usageRecord.aggregate({
      where: { projectId, recordedAt: { gte: today, lt: todayEnd } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadInputTokens: true, cacheCreationInputTokens: true, estimatedCostUsd: true },
    });
    todayData = {
      inputTokens: todayUsage._sum.inputTokens ?? 0,
      outputTokens: todayUsage._sum.outputTokens ?? 0,
      cacheReadTokens: todayUsage._sum.cacheReadInputTokens ?? 0,
      cacheCreationTokens: todayUsage._sum.cacheCreationInputTokens ?? 0,
      estimatedCostUsd: Math.round(Number(todayUsage._sum.estimatedCostUsd ?? 0) * 1_000_000) / 1_000_000,
    };
    todayUsageCache.set(cacheKey, { data: todayData, expiresAt: Date.now() + TODAY_CACHE_TTL_MS });
  }
```

Then in the return value replace the inline today computation with `todayData`:

```typescript
      {
        date: today.toISOString().slice(0, 10),
        inputTokens: todayData.inputTokens,
        outputTokens: todayData.outputTokens,
        cacheReadTokens: todayData.cacheReadTokens,
        cacheCreationTokens: todayData.cacheCreationTokens,
        estimatedCostUsd: todayData.estimatedCostUsd,
      },
```

**Step 2: Verify**

```bash
cd packages/web
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add packages/web/src/lib/server-queries.ts
git commit -m "perf: add 30s in-memory cache for today usage aggregate"
```

---

### Task 10: Final verification

**Step 1: Full TypeScript check across all packages**

```bash
cd packages/api && npx tsc --noEmit
cd ../web && npx tsc --noEmit
```

Expected: 0 errors in both.

**Step 2: Run existing tests**

```bash
cd packages/api
npx vitest run
```

Expected: all pass (no outlier-related tests remain).

**Step 3: Verify Prisma client is in sync**

```bash
cd packages/api
npx prisma generate
```

Expected: client generated without `SessionOutlierEvent` or `ProjectToolBaseline`.

**Step 4: Final commit if anything left unstaged**

```bash
git status
```

If clean, done. If any files remain, stage and commit.
