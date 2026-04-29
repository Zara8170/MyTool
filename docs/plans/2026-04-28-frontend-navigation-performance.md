# Frontend Navigation Performance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 대시보드 내 페이지 이동 시 체감 속도를 개선한다.

**Architecture:** 두 가지 축으로 접근한다. (1) `loading.tsx` 스켈레톤 파일을 추가해 레이아웃 셸이 즉시 보이도록 하고 페이지 콘텐츠는 스트리밍으로 채운다. (2) `serverFetch`에 캐시 옵션을 추가해 레이아웃이 매 이동마다 `me` + `project`를 새로 호출하지 않도록 한다. 페이지별 세션/통계 데이터는 기존처럼 `no-store`를 유지한다.

**Tech Stack:** Next.js App Router (Server Components, Streaming), TypeScript

---

## 현재 병목 정리

| 문제 | 위치 | 영향 |
|------|------|------|
| `cache: "no-store"` 하드코딩 | `server-api.ts:34` | 모든 fetch가 캐시 불가 |
| 레이아웃이 매 이동마다 `me` + `project` 재호출 | `layout.tsx:19-22` | 이동할 때마다 2번 추가 네트워크 요청 |
| `loading.tsx` 없음 | 전 경로 | 데이터 완료 전까지 화면 전환 없음 |

---

## Task 1: `serverFetch`에 캐시 옵션 추가

레이아웃 데이터처럼 자주 바뀌지 않는 데이터는 `next: { revalidate }` 로 캐싱할 수 있게 한다.  
기존 호출부는 모두 `no-store`가 기본값으로 유지되므로 동작 변화 없음.

**Files:**
- Modify: `packages/web/src/lib/server-api.ts:22-35`

**Step 1: `serverFetch` 시그니처 및 fetch 옵션 수정**

```ts
// packages/web/src/lib/server-api.ts

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

  // ... 나머지 에러 처리는 그대로
```

`next`가 없으면 기존처럼 `cache: "no-store"`, `next`가 있으면 Next.js 캐시 사용.

**Step 2: 변경 후 타입 에러 확인**

```bash
cd packages/web && npx tsc --noEmit
```

Expected: 에러 없음 (기존 호출부는 `next` 없이 쓰므로 영향 없음)

**Step 3: Commit**

```bash
git add packages/web/src/lib/server-api.ts
git commit -m "feat(web): allow optional Next.js revalidate cache in serverFetch"
```

---

## Task 2: 레이아웃 데이터 캐싱

레이아웃이 매 이동마다 호출하는 `me`(사용자 이메일)와 `project`(프로젝트 이름)는
자주 바뀌지 않는다. 60초 캐시를 적용해 사이드바 재렌더링 비용을 제거한다.

**Files:**
- Modify: `packages/web/src/app/dashboard/[projectId]/layout.tsx:19-22`

**Step 1: `Promise.all`에 `next.revalidate` 추가**

```ts
// layout.tsx:19-22 를 아래로 교체
const [me, project] = await Promise.all([
  serverFetch<MeResponse>("/api/auth/me", { next: { revalidate: 60 } }),
  serverFetch<Project>(`/api/projects/${projectId}`, { next: { revalidate: 30 } }),
]);
```

`me` 60초: 이메일/org 멤버십은 거의 변하지 않음  
`project` 30초: 프로젝트 이름 정도만 표시하므로 짧은 TTL로 충분

**Step 2: 타입 에러 확인**

```bash
cd packages/web && npx tsc --noEmit
```

Expected: 에러 없음

**Step 3: Commit**

```bash
git add packages/web/src/app/dashboard/[projectId]/layout.tsx
git commit -m "perf(web): cache layout me+project fetches to speed up dashboard navigation"
```

---

## Task 3: `loading.tsx` 추가 (체감 속도 최대 효과)

`loading.tsx`가 있는 라우트는 Next.js가 자동으로 `<Suspense>`로 감싼다.
레이아웃 셸(사이드바)은 즉시 렌더링되고, 페이지 콘텐츠만 스트리밍으로 채워진다.
Task 2로 레이아웃 캐시가 붙으면 사이드바도 거의 즉시 보인다.

**Files:**
- Create: `packages/web/src/app/dashboard/[projectId]/loading.tsx`
- Create: `packages/web/src/app/dashboard/[projectId]/sessions/loading.tsx`
- Create: `packages/web/src/app/dashboard/[projectId]/skills/loading.tsx`
- Create: `packages/web/src/app/dashboard/[projectId]/sessions/[sessionId]/loading.tsx`

**Step 1: Overview 로딩 스켈레톤 생성**

```tsx
// packages/web/src/app/dashboard/[projectId]/loading.tsx
export default function OverviewLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-8 w-32 bg-panel rounded" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-panel border rounded-lg p-4 h-20" />
        ))}
      </div>
      <div className="bg-panel border rounded-lg h-48" />
    </div>
  );
}
```

**Step 2: Sessions 목록 로딩 스켈레톤 생성**

```tsx
// packages/web/src/app/dashboard/[projectId]/sessions/loading.tsx
export default function SessionsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-24 bg-panel rounded" />
      <div className="bg-panel border rounded-lg overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-10 border-b last:border-b-0 px-4 flex items-center">
            <div className="h-3 w-32 bg-muted/20 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 3: Skills 로딩 스켈레톤 생성**

```tsx
// packages/web/src/app/dashboard/[projectId]/skills/loading.tsx
export default function SkillsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-24 bg-panel rounded" />
      <div className="bg-panel border rounded-lg p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex justify-between">
            <div className="h-3 w-40 bg-muted/20 rounded" />
            <div className="h-3 w-12 bg-muted/20 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 4: Session 상세 로딩 스켈레톤 생성**

```tsx
// packages/web/src/app/dashboard/[projectId]/sessions/[sessionId]/loading.tsx
export default function SessionDetailLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-panel rounded" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-panel border rounded-lg p-4 h-16" />
        ))}
      </div>
      <div className="bg-panel border rounded-lg h-64" />
    </div>
  );
}
```

**Step 5: Commit**

```bash
git add packages/web/src/app/dashboard/
git commit -m "feat(web): add loading skeletons to dashboard routes for instant visual feedback"
```

---

## 검증 방법

1. 브라우저 DevTools → Network 탭 → "Slow 3G" 스로틀 적용
2. 사이드바 Overview → Sessions → Skills 순으로 클릭
3. 기대 동작:
   - 클릭 즉시 스켈레톤 UI가 보임 (레이아웃 캐시 후)
   - 데이터 로딩 완료 시 콘텐츠로 교체
   - 두 번째 이동부터는 레이아웃 재요청 없음 (Network 탭에서 `me`/`project` API 호출 없어야 함)

---

## 작업 순서 요약

| 순서 | Task | 효과 |
|------|------|------|
| 1 | `serverFetch` 캐시 옵션 추가 | 기반 작업 |
| 2 | 레이아웃 `me`+`project` 캐싱 | 실제 요청 수 감소 |
| 3 | `loading.tsx` 스켈레톤 추가 | 체감 속도 즉시 개선 |
