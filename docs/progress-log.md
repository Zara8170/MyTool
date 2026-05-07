# mytool 통합 진행 로그

> 매 세션마다 한 두 줄씩 추가. 새 세션 시작 시 이 파일을 먼저 읽으면 즉시 컨텍스트 복구.
> 큰 결정 사항은 `integration-plan.md` 의 §10a 에 별도 기록.

## 2026-05-07

### Session 1 — 설계 + PR 1 완료
- claude-sync 단독 도구 완성 (`C:\git\personal\claude-sync`).
- mytool 통합 설계 v2 작성 (`C:\git\personal\mytool\docs\integration-plan.md`).
  - 4축 비전 (Memory · Skills · Execution + Observability backbone)
  - hook 3종 (SessionStart / PreToolUse / Stop), fail-open
  - 일본 서버 SLA: SessionStart 800ms, PreToolUse 500ms
  - daemon 모드 (PR 11) — Vercel 호스팅에 필수
- **PR 1 구현 완료** — Project 토글 + UI:
  - `Project` 모델에 `syncEnabled`/`harnessEnabled`/`harnessConfig` 추가
  - 마이그레이션 SQL 파일 작성 (`20260507120000_add_sync_harness_toggles`)
  - shared 의 `PatchProjectSchema` 신규
  - api 의 PATCH 라우트 신규 (Hono + Next.js 양쪽)
  - Overview 페이지에 "Workspace" 섹션 + 토글 카드 2개
  - 검증: 미진행 (사용자님 PC 에서 일괄 검증 예정)

### 다음 세션 시작 시
1. `docs/integration-plan.md` 읽기 — 4축 비전, 결정사항 (§10a)
2. `docs/progress-log.md` (이 파일) 읽기 — 어디까지 했는지
3. PR 1 검증 결과 사용자님께 확인 후 M1 (PR 2 + 3) 진행
