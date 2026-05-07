# Design: Outlier Removal, Forgotten Skills, Today Cache

Date: 2026-05-07

## Overview

Three changes to simplify the codebase and add more useful observability:

1. **Remove** outlier detection and baseline (unused in practice)
2. **Add** "forgotten skills" detection per user (skills used in past 4 weeks but not past 7 days)
3. **Add** 30s in-memory cache for today's usage aggregate

## 1. Outlier + Baseline Removal

### What gets removed

| Layer | Target |
|-------|--------|
| DB schema | `SessionOutlierEvent` table, `ProjectToolBaseline` table, `ClaudeSession.outlierCount`, `ClaudeSession.outlierRatio` |
| API lib | `packages/api/src/lib/outlier.ts`, `packages/api/src/lib/baseline.ts` |
| API routes | `events.ts` async calls to outlier/baseline; `dashboard.ts` `outliersByToolRaw` query, `baselineComparison`, sessions `outlierCount`/`outlierRatio` fields |
| Web lib | `packages/web/src/lib/outlier.ts`, `packages/web/src/lib/baseline.ts` |
| Web API routes | summary, sessions, session-detail routes — remove outlier fields |
| Web UI | Dashboard "Slow tools" section, sessions list `outlierCount` column, session detail `baselineComparison` section |
| Prisma migration | DROP TABLE session_outlier_events, DROP TABLE project_tool_baselines, DROP COLUMN outlier_count/outlier_ratio from claude_sessions |

### No new tables or APIs needed.

## 2. Forgotten Skills Detection

### API

```
GET /api/projects/:projectId/dashboard/forgotten-skills?userId=<required>
```

Query logic:
- Set A = distinct skillNames used by userId in past 28 days (isSkillCall=true)
- Set B = distinct skillNames used by userId in past 7 days (isSkillCall=true)
- forgotten = A - B (set difference)
- Also return lastUsedAt for each forgotten skill

Response:
```json
{
  "forgottenSkills": [
    { "skillName": "gstack", "lastUsedAt": "2026-04-20T10:00:00Z" },
    { "skillName": "investigate", "lastUsedAt": "2026-04-15T..." }
  ]
}
```

No new DB tables — uses existing `event` table (`isSkillCall`, `skillName`, `timestamp`, `userId`).

### Web

- New API route: `GET /api/projects/[projectId]/dashboard/forgotten-skills`
- New UI section in dashboard page: "최근 1주일 동안 쓰지 않은 스킬"
- Requires `userId` query param (user must select themselves or a member)

## 3. Today Usage Cache

### Where

`packages/api/src/routes/dashboard.ts` — the today realtime aggregate in `/dashboard/usage`

### Implementation

```ts
const todayCache = new Map<string, { data: TodayUsage; expiresAt: number }>()
const TODAY_TTL_MS = 30_000

function getCachedToday(key: string) { ... }
function setCachedToday(key: string, data: TodayUsage) { ... }
```

Cache key: `projectId` (no userId filter on usage aggregate).

Single-process Node.js server — no Redis needed.

## What stays unchanged

- Health check (`packages/api/src/routes/health.ts`) — already has DB ping + 503, better than argos
- Slow query handling — `DailyProjectStats` pre-aggregation already handles this
- Retry / circuit breaker / APM / distributed tracing — not needed at this scale
- Timeout values (3s hook, 10s API) — adequate
