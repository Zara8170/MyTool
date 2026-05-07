# mytool 통합 설계서 — claude-sync + claude-harness

> **상태**: v2 초안 (2026-05-07 갱신)
> **목표**: 기존에 별도로 만들던 `claude-sync` (Node.js CLI) 와 `claude-harness` (Python CLI) 를 mytool 모노레포에 흡수. 더 나아가 mytool 의 정체성을 **"옵저버빌리티 도구"** 에서 **"Claude Code 워크스페이스"** 로 재정립한다.

## 0. 비전 — 4축 워크스페이스

mytool 은 다음 4축으로 재구성된다.

| 축 | 무엇을 다루나 | 어디에 사는 데이터 |
| --- | --- | --- |
| **Memory** | 컨텍스트 — `CLAUDE.md`, `AGENTS.md`, hookify 규칙, 프로젝트 컨벤션, 템플릿 | 사용자 PC 의 파일 (web 으로 편집 후 daemon 이 동기화) |
| **Skills** | 도구 라이브러리 — 전역·프로젝트 스킬, agents, commands, MCP 설정 | `~/.claude/skills/`, `<root>/.claude/skills/` 등 |
| **Execution** | 자동화·강제 — harness 사이클, PreToolUse 강제 규칙, 슬래시 커맨드 라이브러리, 작업 레시피 | mytool DB + Claude Code hook |
| **Observability** (backbone) | 토큰·비용·도구 호출 추적 | mytool DB. 위 3축에 인사이트 공급. |

### 0.1 정체성 재정립의 의미

기존:
> Claude Code observability for individuals and small teams.

새 정체성 (잠정):
> Your personal Claude Code workspace — manage your memories, skills, and execution from one place.
> 모니터링은 죽이지 않는다. backbone 으로 남아 다른 3축을 똑똑하게 만든다.

**옵저버빌리티는 죽이는 게 아니라 강등** 된다. 메인 메뉴의 한 자리가 아니라 **다른 모든 기능을 풍부하게 만드는 데이터 레이어** 가 된다.

### 0.2 현재 PR 들이 어느 축을 채우는가

이 설계서의 PR 1~10 은 그대로 가되, 각 PR 이 어느 축에 속하는지 명시:

| PR | 축 | 채우는 것 |
| --- | --- | --- |
| PR 1 (토글) | 4축 모두 | 프로젝트별 ON/OFF 인프라 |
| PR 2 (sync 라이브러리) | Skills | 스캐너·번들러·마스킹 |
| PR 3 (Sync API + Settings 페이지) | Skills | 스킬 이전 UI |
| PR 4 (harness 격리) | Execution | Python 통합 |
| PR 5 (Harness API) | Execution | run·event 모델 |
| PR 6 (Harness UI) | Execution | yaml 편집 + phase 타임라인 |
| PR 7 (선택) | Observability ↔ 3축 | "안 쓰는 스킬 추천" 등 인사이트 결합 |
| PR 8 (SessionStart hook) | Execution | Claude Code 컨텍스트 주입 |
| PR 9 (PreToolUse 강제) | Execution | 행동 제어 |
| PR 10 (Stop hook) | Execution | 사이클 마무리 |
| PR 11 (cli daemon) | 4축 backbone | 양방향 채널 — Memory 축 가능하게 함 |
| PR 12+ (Memory 축) | Memory | 추후 결정. PR 11 이 끝나면 가능. |

**즉, PR 1~10 은 정체성 재정립 없이도 그대로 진행**된다. 비전 명시는 다음 기능이 어디로 갈지 결정하는 기준일 뿐이다.

### 0.3 정체성 변경 시점

PR 10 까지 끝낸 뒤 **실제 사용해보면서** 결정한다. 구체 행동:

- README, package.json description, Vercel project description 변경 — PR 10 후
- 새 README 의 "What you manage" 섹션 추가
- 옵저버빌리티 우선 → 워크스페이스 우선으로 IA(Information Architecture) 재배치
- `mytool` 라는 이름은 당분간 유지 (npm 패키지·도메인 변경은 사용자 늘기 전에는 부담 적음)

### 0.4 4축 비전이 만드는 새 가능성

비전을 명시해두면 향후 이런 기능들이 자연스럽게 들어온다 (PR 12+ 후보):

- **Memory**: 프로젝트 템플릿 라이브러리, CLAUDE.md 버전 히스토리, "이 프로젝트에서 자주 보는 에러" 자동 메모리화
- **Skills**: 스킬 만들기 도우미 (web 폼 → skill-creator 호출), 팀 공유 스킬 마켓
- **Execution**: 작업 레시피 ("PR 리뷰 모드", "리팩터링 모드"), 슬래시 커맨드 라이브러리
- **Observability backbone 활용**: 안 쓰는 자산 정리 추천, harness 실패 패턴 분석, 비용 알림

이런 기능들을 **지금 만들지 않는다**. 단지 들어올 자리를 비워두고 PR 1~10 을 진행한다.

## 1. 배경과 동기

mytool 은 이미 다음을 갖고 있다:

- 프로젝트 등록·인증 (`Project`, `Organization`, `OrgMembership`)
- 토큰·도구 호출 추적 (`Event`, `UsageRecord`, `ClaudeSession`)
- 셀프호스팅 가능한 web/api/cli 모노레포 (pnpm + turbo + Hono + Next.js)
- 사용자별 settings 페이지

claude-sync 는 "어떤 스킬이 어디 있는가" 를, claude-harness 는 "그 프로젝트에서 자동 구현 사이클을 돌릴 것인가" 를 다룬다. 둘 다 **프로젝트 단위 상태 + 토글 UI + 결과 시각화** 가 필요한데, mytool 이 이미 그 기반을 갖고 있다.

통합 후 가능해지는 시나리오:

- 프로젝트 상세 페이지에서 "이 프로젝트가 사용 중인 스킬" (mytool 의 호출 통계) 을 보고, 같은 화면에서 "다른 프로젝트에 복사" (sync) 버튼 클릭
- "이 프로젝트에 harness 켜기" 토글 → harness 가 만든 커밋이 mytool 의 세션 타임라인에 함께 표시
- 자주 안 쓰는 스킬은 mytool 통계로 발견 → sync 가 다른 프로젝트로 옮기거나 제거

## 2. 흡수 대상 정리

### 2.1 claude-sync (Node.js, MIT)

- 현재 위치: `C:\git\personal\claude-sync`
- 의존성: `commander`, `@inquirer/prompts`, `archiver`, `yauzl`, `chalk`
- 핵심 라이브러리: `scanner`, `bundle`, `mask`, `preset` (모두 ESM `.mjs`)
- 동작 방식: 로컬 파일시스템 직접 스캔 → zip/dir 패키지 → 다른 PC 에서 적용

### 2.2 claude-harness (Python, 미정)

- 현재 위치: `C:\git\personal\claude-harness`
- 의존성: Python 3 + `claude` CLI (subprocess)
- 핵심 모듈: `phases/{ideation,build,verify,report}.py`, `runner.py`, `state.py`, `config.py`
- 동작 방식: `harness.yaml` 의 요구사항을 순회하며 Claude Code 호출 → verify_cmd 실행 → git commit/reset

### 2.3 두 도구의 결합 방식 차이

|  | claude-sync | claude-harness |
| --- | --- | --- |
| 언어 | TypeScript/JS (mytool 과 동일) | Python (이질적) |
| 통합 난이도 | 낮음 — 라이브러리 재사용 가능 | 중간 — process 경계 필요 |
| 실행 위치 | mytool API/web 와 같은 프로세스 가능 | 별도 subprocess (`harness run`) |
| 결과 데이터량 | 작음 (메타데이터 + 파일 사본) | 작음 (phase 전이 이벤트, git sha) |

이 차이가 패키징 전략을 바꾼다 (§4 참고).

## 3. 최종 모노레포 구조

```
mytool/
├── packages/
│   ├── api/             # 기존 — 라우트 추가만
│   ├── web/             # 기존 — settings/sync, dashboard/[id]/harness 페이지 추가
│   ├── cli/             # 기존 (mytool-ai) — sync 서브명령 추가
│   ├── shared/          # 기존 — 공통 스키마 추가
│   ├── sync/            # 신규 — claude-sync 의 lib/cli 흡수 (TypeScript 로 변환)
│   └── harness/         # 신규 — Python 패키지 그대로 (pnpm 워크스페이스에는 비참여)
├── pnpm-workspace.yaml  # packages/* 패턴 유지, harness 는 .pnpmignore 또는 명시 제외
├── turbo.json           # harness 의 build/test 는 turbo task 로 정의 (pyproject 호출)
└── ...
```

### 패키지별 책임

- `packages/sync` — 파일시스템 스캐너, 번들러, 마스킹 (라이브러리 + CLI). API 와 web 이 import 해서 사용.
- `packages/harness` — Python 패키지. `pyproject.toml` 유지. mytool API 가 subprocess 로 호출하고 진행상황은 HTTP report 로 받음.
- `packages/api` — `/api/sync/*`, `/api/projects/:id/harness/*` 라우트 추가.
- `packages/web` — Settings 의 신규 탭 + 프로젝트 상세 페이지 토글.
- `packages/shared` — `SyncItem`, `SyncManifest`, `HarnessRun`, `HarnessPhaseEvent` 같은 공유 스키마.

## 3a. Claude Code 와의 통합 — hook 3종

mytool web 의 토글이 **실제로 Claude Code 의 행동에 반영되려면** Claude Code 의 hook 인프라를 거쳐야 한다. mytool 이 이미 hook 으로 데이터를 받고 있으니, 같은 mytool-cli 에 발신용 hook 을 추가한다.

핵심 원칙:

- **mytool API 가 죽어 있어도 Claude Code 는 멈추지 않는다** — 모든 hook 은 짧은 timeout 후 fallback (allow) 으로 빠짐
- mytool 은 "Claude Code 가 사용자 PC 에서 도는 동안 실시간으로 외부 두뇌 역할" 을 한다
- 토글 변경은 **다음 hook 호출부터 즉시 반영** (mytool 측 캐시 없음, 매번 DB 조회)

### 3a.1 SessionStart hook — 컨텍스트 주입

세션 시작 시 mytool 이 이 프로젝트의 현재 상태를 시스템 프롬프트에 주입.

```
세션 시작 → mytool-cli session-start hook
         → GET /api/projects/<id>/runtime-context  (800ms timeout, 일본 서버 고려)
         → { harness: { active, currentRequirement, lastVerify, verifyCmd },
             sync:    { activeSkills: [...], recentlyUsedSkills: [...] },
             notes:   string[] }
         → stdout 으로 시스템 프롬프트에 주입 (additionalContext)
```

API 가 응답 안 하면 빈 컨텍스트 → Claude Code 일반 동작.

### 3a.2 PreToolUse hook — 행동 제어

이게 진짜 강제 메커니즘. Claude 가 도구를 호출하기 직전 mytool 이 가로채서 allow/deny/modify 결정.

```
도구 호출 시도 → mytool-cli pretool hook
              → POST /api/projects/<id>/pretool-decision  (500ms timeout, 일본 서버 고려)
                 body: { tool, args, sessionId }
              → { decision: "allow" | "deny" | "modify",
                  reason?: string,
                  modifiedArgs?: object }
              → hook 이 stdin/exit code 로 Claude Code 에 전달
```

mytool API 가 응답 안 하면 default `allow`. 사용자 작업이 인질 잡히지 않음.

> **일본 서버 latency 보정**: Vercel + Supabase 가 일본 리전이라 한국 ↔ 일본 RTT (~30~80ms) + cold start 를 고려해 timeout 을 넉넉히 잡았다. 그래도 PreToolUse 의 500ms 는 사용자가 체감하면 살짝 거슬릴 수 있어, **PR 11 의 cli daemon** 이 들어오면 hook 호출이 daemon 의 인메모리 캐시를 거쳐 100ms 이내로 떨어진다 (§3a.7 참고).

#### harness 활성화 시 강제 규칙 예

| 시나리오 | mytool 의 결정 |
| --- | --- |
| `git commit ...` 호출 | `verifyCmd` 가 직전 turn 에서 통과했으면 allow, 아니면 deny + reason: "verify 먼저 돌려라" |
| `git push --force` 호출 | deny (harness 모드 무조건 차단) |
| 한 turn 에 5개 이상 파일 수정 | modify — "현재 진행 중인 req-001 범위로 좁혀라" 안내 |
| `verifyCmd` 자체 실행 (Bash) | allow + DB 에 verify_started 기록 |

규칙은 `Project.harnessConfig.rules` 에 JSON 으로 저장 → 사용자가 web 에서 편집 가능.

### 3a.3 Stop hook — 사이클 마무리

Claude 가 한 turn 응답을 끝낼 때 mytool 이 받아서 phase 분류 + DB 기록.

```
turn 종료 → mytool-cli stop hook
         → POST /api/projects/<id>/turn-completed
            body: { sessionId, toolCalls, durationMs, exitReason }
         → mytool 측: harness run 의 phase 전이 판단
                    (verify 통과 후 commit 됐다면 → req 완료, 다음 req 로)
```

응답 못 받아도 손실 없음. 다음 turn 의 SessionStart 가 어차피 최신 상태를 다시 가져옴.

### 3a.4 hook 등록은 자동

mytool-cli 의 기존 hook 주입 메커니즘 (`packages/cli/src/hooks-inject.ts`) 을 확장:

- 사용자가 mytool web 에서 프로젝트의 harness/sync 토글 ON 하면
- 다음 mytool-cli 명령 실행 시 해당 프로젝트의 `.claude/settings.json` 에 SessionStart/PreToolUse/Stop hook 자동 등록
- 토글 OFF 하면 hook 자동 제거 (멱등성 보장된 기존 inject 로직 재사용)

사용자는 hook 설정을 직접 만질 필요 없음.

### 3a.5 Fallback 동작 (mytool 다운 시)

| 상황 | Claude Code 동작 |
| --- | --- |
| API 응답 2xx | 정상 (allow/deny/modify 따름) |
| API 응답 5xx | hook 이 default allow + 디버그 로그 |
| API timeout (>500ms PreToolUse, >800ms SessionStart) | hook 이 default allow + 디버그 로그 |
| 네트워크 끊김 | 동일 — default allow |
| mytool-cli 자체 미설치 | hook 등록 자체가 없으니 기본 동작 |
| daemon 모드 ON · API 다운 | daemon 의 stale 캐시로 직전 결정 재사용 (TTL 60초). 그 이상은 default allow |

이로써 **mytool 이 죽어도 Claude Code 가 같이 멈추는 일은 없음**. 단지 강제 규칙이 일시적으로 풀릴 뿐.

### 3a.6 보안 — token 기반 인증

PreToolUse hook 은 도구 호출 정보 (path, command 등) 를 mytool API 로 보낸다. 민감 정보 누출 방지:

- mytool-cli 가 사용자 머신에서 발급받은 short-lived token (`CliToken` 모델 활용) 으로 인증
- API 측에서 path/command 는 절대 평문 저장 안 함, 결정 로깅만 (decision, ruleId, ts)
- `--mask-secrets` 와 동일한 마스킹 로직을 hook 페이로드에도 적용

### 3a.7 mytool-cli daemon 모드 (PR 11)

지금 mytool-cli 는 **요청-응답 일회성** 으로 동작한다 (Claude Code 가 hook 호출 → cli 실행 → API 호출 → 종료). 4축 비전, 특히 Memory 축에서 **web 의 변경이 사용자 PC 에 즉시 반영** 되려면 cli 가 **상시 실행되는 daemon** 으로 진화해야 한다.

#### 동작 방식

```
mytool-cli daemon                  mytool API (Vercel)
       │                                  │
       ├──────── WebSocket / SSE 채널 ────┤
       │                                  │
   [hook 응답 캐시]                  [DB 변경 감지]
   [파일 watcher]                    [push: file change, rule update]
   [파일 동기화 큐]
       │
       └──── 파일시스템 (~/.claude, project/.claude, CLAUDE.md)
```

핵심 책임:

1. **hook 응답 캐시**: SessionStart/PreToolUse hook 호출 시 매번 API 가는 대신 daemon 의 인메모리 캐시에서 응답. TTL 60 초. API push 받으면 즉시 무효화. 이러면 **PreToolUse latency 가 100ms 이내** 로 떨어진다.
2. **파일 동기화**: web 에서 사용자가 CLAUDE.md 편집하면 → API 가 daemon 에 push → daemon 이 사용자 PC 의 실제 파일 업데이트. 반대 방향도 (파일 watcher → API push).
3. **장애 복원**: API 다운 시 stale 캐시로 60 초 더 버팀. 60 초 지나면 fail-open.
4. **인증**: daemon 시작 시 한 번 OAuth-like 로 토큰 발급 (`mytool login`). 이후 토큰으로 WebSocket 인증.

#### 무엇이 좋아지나

| 측면 | daemon 없이 | daemon 있을 때 |
| --- | --- | --- |
| PreToolUse latency | 500ms (일본 RTT + cold start) | 100ms 이내 |
| Memory 축 양방향 동기화 | 어려움 (web ↔ PC 채널 없음) | 자연스럽게 됨 |
| API 일시 장애 시 | 즉시 fail-open | 60 초 버팀 |
| 파일 변경 감지 | 없음 | watcher 로 즉시 인식 |
| 사용자 경험 | hook 호출마다 약한 끊김 | 매끄러움 |

#### 보수적 설계

- daemon 은 **선택사항**. 없어도 PR 1~10 의 모든 기능은 동작 (지금처럼 일회성 cli 호출).
- `mytool daemon start` / `stop` / `status` 로 사용자가 명시 제어. 자동 시작 안 함.
- 사용자가 주의해야 할 자원: 메모리 ~50MB, 백그라운드 CPU ~0% (idle), 파일 watcher 가 노드 모듈 등 무관한 폴더는 무시 (gitignore-aware)

#### 셀프호스팅 vs SaaS 차이

- **셀프호스팅** (mytool API 가 사용자 PC 에서 도는 경우): daemon 없어도 API 가 직접 fs 접근 가능. daemon 의 가치는 latency 만.
- **SaaS / Vercel 호스팅** (지금 사용자님 케이스): daemon 이 **유일한** PC 접근 경로. Memory 축 구현하려면 사실상 필수.

## 4. Python 통합 전략 (harness)

pnpm 모노레포에 Python 을 끼우는 건 흔치 않으니 명시적 규칙을 둔다.

### 4.1 워크스페이스 격리

- `pnpm-workspace.yaml` 의 `packages` 패턴을 `packages/!(harness)/*` 같은 형태가 아닌, **명시 목록**으로 바꿔서 `harness` 만 제외. (pnpm 은 negative pattern 도 지원하지만 명시 목록이 안전)

```yaml
packages:
  - "packages/api"
  - "packages/web"
  - "packages/cli"
  - "packages/shared"
  - "packages/sync"
  # packages/harness 는 Python — pnpm 미참여
```

### 4.2 turbo task 정의

```json
{
  "tasks": {
    "harness#build": { "cache": false, "outputs": [] },
    "harness#test": { "cache": false, "outputs": [] }
  }
}
```

각 task 는 `packages/harness/Makefile` (또는 `package.json` 안에 `"scripts": {"build": "uv build", "test": "pytest"}`) 을 호출한다. **package.json shim** 을 둬서 turbo 가 인식하도록만 하고 실제 작업은 Python 도구로 위임.

### 4.3 런타임 통합 — HTTP report 패턴

harness 코드를 직접 호출하지 않고, **API 가 subprocess 로 `harness run --report-url <api>` 를 띄우고 진행상황은 harness 가 POST 로 보고**한다.

```
mytool web ──(클릭)──> mytool api ──(spawn)──> harness CLI ──(POST/SSE)──> mytool api ──(broadcast)──> mytool web
```

장점: harness 는 mytool 을 모르는 채로 일반 CLI 로도 쓸 수 있다 (--report-url 없으면 stdout만). 의존 방향이 한쪽이라 결합도 낮음.

추가할 것:
- `harness` 측: `--report-url` 옵션, phase 전이마다 `POST {url}/api/projects/:id/harness/events` 호출
- `mytool api` 측: 토큰 발급 (`POST /api/projects/:id/harness/start` 가 token 과 url 반환), event 수신, 상태 머신 관리

## 5. DB 스키마 변경

기존 `Project` 에 토글·설정 필드 추가, 새 모델 두 개.

```prisma
model Project {
  // ... 기존 필드 ...
  syncEnabled    Boolean   @default(true)   // sync 페이지 노출 여부
  harnessEnabled Boolean   @default(false)  // harness 토글
  harnessConfig  Json?                       // harness.yaml 캐시 (UI 편집용)
}

model SyncSnapshot {
  id          String   @id @default(cuid())
  orgId       String
  createdBy   String
  createdAt   DateTime @default(now())
  // 마지막으로 스캔한 결과를 캐시. 실제 스캔은 사용자 머신에서 일어남.
  payload     Json     // { items: SyncItem[], scannedAt }
  source      String   // hostname or device id
  org         Organization @relation(fields: [orgId], references: [id])

  @@index([orgId, createdAt])
}

model HarnessRun {
  id            String   @id @default(cuid())
  projectId     String
  startedBy     String
  startedAt     DateTime @default(now())
  finishedAt    DateTime?
  status        String   // running | passed | failed | aborted
  iterations    Int      @default(0)
  reportToken   String   @unique  // CLI 가 인증에 사용
  configSnapshot Json?

  project       Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  events        HarnessEvent[]

  @@index([projectId, startedAt])
}

model HarnessEvent {
  id        String   @id @default(cuid())
  runId     String
  ts        DateTime @default(now())
  phase     String   // ideation | build | verify | report
  level     String   // info | warn | error
  payload   Json
  run       HarnessRun @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@index([runId, ts])
}
```

마이그레이션 이름 예: `20260507_add_sync_harness_tables`.

## 6. API 라우트

### 6.1 sync 관련

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/api/sync/scan?source=local` | 로컬 머신에서 스캔한 결과를 cli 가 업로드 (POST 가 더 적절 — 아래 참고) |
| POST | `/api/sync/snapshots` | cli 가 스캔 결과 업로드. `{ items, source }` |
| GET | `/api/sync/snapshots/latest` | 가장 최근 스냅샷 반환 |
| POST | `/api/sync/copy` | `{ items: SyncItem[], targetProjectIds: string[], options: { mask, overwrite } }`. mytool 자체 파일시스템 접근 권한이 있는 환경에서만 동작. 또는 web 이 cli 에게 명령을 큐로 전달. |
| POST | `/api/sync/export` | zip 다운로드 (스냅샷에서 골라 묶음) |

**중요**: web 은 사용자 PC 의 `~/.claude` 를 직접 못 본다. 두 가지 선택지:

1. **로컬 셀프호스팅** — mytool api 가 사용자 PC 에서 도니까 `fs` 직접 접근. 단순. 기본 가정.
2. **원격 SaaS 모드** — cli (`mytool sync push`) 가 스캔 후 API 에 업로드, web 에서 조작, cli (`mytool sync pull`) 가 결과를 받아 적용. 복잡하지만 팀 공유에 유리.

**1단계는 (1) 셀프호스팅 모드만 지원**. (2) 는 future work 로.

### 6.1a Claude Code hook 관련 (3a 섹션 참고)

| Method | Path | 설명 | Timeout SLA (일본 서버) | daemon 경유 시 |
| --- | --- | --- | --- | --- |
| GET | `/api/projects/:id/runtime-context` | SessionStart hook. 토글 상태·요구사항·통계 반환 | 800ms | ~50ms (캐시) |
| POST | `/api/projects/:id/pretool-decision` | PreToolUse hook. allow/deny/modify 결정 | 500ms | ~100ms (캐시 + WS) |
| POST | `/api/projects/:id/turn-completed` | Stop hook. phase 전이 기록 | 비동기 OK | 비동기 OK |
| WS | `/ws/daemon` | daemon 양방향 채널 (PR 11). DB 변경 push, 파일 동기화 명령 | keep-alive | — |

이 라우트들은 **응답 빠른 게 모든 것** 이다. 일본 리전 RTT (~30~80ms) 와 Vercel cold start 를 고려해 timeout 을 넉넉히 잡았지만, **PR 11 의 daemon 이 도입되면 hook 은 daemon 의 인메모리 캐시를 거쳐 100ms 이내** 로 떨어진다.

운영 규칙:

- DB 쿼리는 인덱스 보장 (`Project.id`, `HarnessRun.projectId+status`)
- `pretool-decision` 은 daemon 모드 OFF 일 때 캐시 없이 매번 fresh, ON 일 때 daemon 이 60초 TTL 캐시
- 헬스체크에서 이 세 라우트의 p95 latency 모니터링
- Vercel cold start 완화: keep-alive ping (1분 간격), 또는 Edge Function 으로 마이그레이션 검토

### 6.2 harness 관련

| Method | Path | 설명 |
| --- | --- | --- |
| POST | `/api/projects/:id/harness/start` | 새 run 생성. `reportToken` 과 `runId` 반환. 응답 후 api 가 subprocess spawn. |
| POST | `/api/harness/runs/:runId/events` | harness CLI 가 phase 전이마다 호출. Bearer = reportToken. |
| GET | `/api/projects/:id/harness/runs` | run 목록 |
| GET | `/api/harness/runs/:runId/stream` | SSE — web 이 라이브 로그 받기 |
| POST | `/api/harness/runs/:runId/abort` | 중단 |

## 7. Web UI

### 7.1 신규 페이지: `/settings/sync`

레이아웃 (3열):

```
┌──────────────┬────────────────────────────┬──────────────┐
│ 소스(Source) │ 어떤 항목? (Items)         │ 대상(Target) │
│              │                            │              │
│ [○ 전역]     │ ☑ global:skill docx        │ ☐ advisor    │
│ [● shop-mock]│ ☐ global:skill pdf         │ ☑ shop-mock  │
│ [○ advisor]  │ ☑ project:skill add-api... │ ☑ ce-web     │
│              │ ☐ project:hookify ...      │              │
│              │                            │ 옵션         │
│              │                            │ ☑ 마스킹     │
│              │                            │ ⊙ 백업 후 덮 │
│              │                            │ ○ 강제 덮어  │
│              │                            │ ○ 스킵       │
│              │                            │              │
│              │                            │ [복사 실행]  │
└──────────────┴────────────────────────────┴──────────────┘
```

- 좌: 등록된 프로젝트 + 전역, 라디오 (소스 1개)
- 중: 소스에서 스캔된 항목들. **mytool 의 호출 통계가 같이 표시됨** ("최근 30일 호출: 12회"). "안 쓰는 스킬" 필터 가능
- 우: 한 곳 이상 선택, 옵션 후 실행

### 7.2 프로젝트 상세 페이지에 토글

`/dashboard/[projectId]` 우측에 새 카드:

```
┌─────────────────────────────────┐
│ Sync (스킬 동기화)              │
│ [● 활성화 됨]      [관리하기 →] │
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ Harness (자동 구현)             │
│ [○ 비활성]                      │
│                                 │
│ harness.yaml 편집 후 실행 가능  │
│ [활성화]                        │
└─────────────────────────────────┘
```

활성화하면 같은 페이지에 다음 섹션이 펼쳐짐:

- **Sync 섹션**: 이 프로젝트의 자산 트리 + "다른 프로젝트로 복사" 단축 버튼
- **Harness 섹션**: yaml 편집기 (Monaco) + Run 버튼 + 진행 상황 (SSE 라이브 로그 + 요구사항 체크리스트 + 직전 run 들 목록)

### 7.3 web 컴포넌트 추가 목록

```
packages/web/src/
├── app/
│   ├── settings/
│   │   └── sync/
│   │       └── page.tsx              # 신규
│   └── dashboard/[projectId]/
│       ├── harness/
│       │   ├── page.tsx              # 신규 (또는 카드만)
│       │   └── runs/[runId]/page.tsx # 라이브 로그
│       └── sync/page.tsx             # 신규
├── components/
│   ├── sync/
│   │   ├── ItemTree.tsx
│   │   ├── ProjectPicker.tsx
│   │   └── CopyOptionsForm.tsx
│   └── harness/
│       ├── YamlEditor.tsx
│       ├── PhaseTimeline.tsx
│       └── RunList.tsx
└── lib/
    ├── api/sync.ts
    └── api/harness.ts
```

## 8. 마이그레이션 단계 (PR 단위)

각 PR 은 독립적으로 머지 가능하고 단독으로도 가치가 있게 끊었다.

### PR 1 — Project 토글 + UI 토글 (반나절)
- [ ] Prisma 마이그레이션: `syncEnabled`, `harnessEnabled` 추가
- [ ] `/api/projects/:id` PATCH 라우트에 토글 필드 허용
- [ ] 프로젝트 상세 페이지에 카드 2개 (UI 만)
- 검증: 토글 ON/OFF 가 DB 에 저장되고 새로고침 시 반영

### PR 2 — packages/sync 패키지 신규 + claude-sync lib 이전 (1일)
- [ ] `packages/sync/` 생성, `package.json`
- [ ] `scanner.ts`, `bundle.ts`, `mask.ts`, `preset.ts` (TypeScript 로 변환)
- [ ] CLI shim: `pnpm --filter @mytool/sync start scan` 동작
- [ ] 단위 테스트 — mask 의 connection string 패턴, scanner 의 자동 탐색
- 검증: 기존 claude-sync 와 동일한 결과를 내는지 비교 테스트

### PR 3 — Sync API 라우트 + Settings 페이지 (1.5일)
- [ ] `SyncSnapshot` 마이그레이션
- [ ] `POST /api/sync/snapshots`, `GET .../latest`, `POST /api/sync/copy`
- [ ] `/settings/sync` 페이지 (3열 레이아웃)
- [ ] mytool 의 UsageRecord 와 조인해서 "호출 통계" 컬럼 추가
- 검증: 한 프로젝트에서 다른 프로젝트로 스킬 복사 후 양쪽 폴더 비교

### PR 4 — packages/harness 격리 + 모노레포 통합 (1일)
- [ ] `packages/harness/` 로 Python 코드 이전
- [ ] `pnpm-workspace.yaml` 명시 목록으로 변경
- [ ] turbo task `harness#test`, `harness#build` 정의 (pyproject 호출)
- [ ] CI: Python 3.11 셋업 + pytest
- [ ] harness 에 `--report-url`, `--report-token` 옵션 추가
- 검증: 모노레포 루트에서 `pnpm test` 가 Node + Python 둘 다 돌리는지

### PR 5 — Harness API + Run/Event 모델 + SSE (1.5일)
- [ ] `HarnessRun`, `HarnessEvent` 마이그레이션
- [ ] `POST /api/projects/:id/harness/start` (run 생성, subprocess spawn)
- [ ] `POST /api/harness/runs/:runId/events` (CLI 가 보고)
- [ ] `GET /api/harness/runs/:runId/stream` (SSE)
- 검증: harness 가 phase 전이마다 보고하고 web 에 라이브 표시

### PR 6 — Harness UI (1일)
- [ ] yaml 편집기 (Monaco)
- [ ] PhaseTimeline 컴포넌트
- [ ] RunList + 직전 run 들 표시
- 검증: harness.yaml 편집 → Run 클릭 → 진행 상황이 라이브 로 보임

### PR 7 (선택) — 통합 가치 살리는 기능 (정해질 때)
- [ ] mytool 호출 통계로 "안 쓰는 스킬" 자동 추천
- [ ] harness 의 git commit 을 mytool 의 세션 타임라인에 연결
- [ ] 마스킹 diff 미리보기

### PR 8 — Runtime Context API + SessionStart hook (1일)
- [ ] `GET /api/projects/:id/runtime-context` 라우트 (300ms SLA)
- [ ] `mytool-cli session-start-hook` 서브명령 (stdin 받고 stdout 으로 컨텍스트 출력)
- [ ] 토글 ON 시 `.claude/settings.json` 의 `SessionStart` hook 자동 등록 (기존 hooks-inject 로직 재사용)
- [ ] fallback 검증: API 죽인 채로 Claude Code 시작해도 정상 동작
- 검증: web 에서 harness 토글 ON 후 새 Claude Code 세션 시작 → 시스템 프롬프트에 "harness 활성" 컨텍스트 들어가는지

### PR 9 — PreToolUse 강제 (harness 의 핵심) (1.5일)
- [ ] `POST /api/projects/:id/pretool-decision` 라우트 (200ms SLA)
- [ ] `mytool-cli pretool-hook` 서브명령
- [ ] `Project.harnessConfig.rules` 스키마 정의 + 기본 규칙 ("verify 통과 후 commit", "force push 차단")
- [ ] 200ms timeout 후 default allow 보장 (hook 측 fail-open)
- [ ] web 에 규칙 편집 UI (단순 JSON editor 시작)
- 검증: harness 활성 프로젝트에서 verify 안 돌리고 git commit 시도 → 차단되는지. mytool API 죽이고 같은 시도 → 통과하는지

### PR 10 — Stop hook + run 자동 마무리 (반나절)
- [ ] `POST /api/projects/:id/turn-completed`
- [ ] `mytool-cli stop-hook` 서브명령
- [ ] phase 전이 로직 (verify 통과 + commit → req 완료 처리)
- 검증: harness run 한 사이클이 완전 자동으로 끝까지 돌고 web 의 RunList 에 정확한 phase 시퀀스 남는지

### PR 11 — mytool-cli daemon 모드 + 양방향 채널 (1.5~2일)
- [ ] `mytool daemon start/stop/status` 서브명령
- [ ] WebSocket 클라이언트 — Vercel 의 `/ws/daemon` 엔드포인트와 연결, 토큰 인증
- [ ] 서버측 WebSocket 라우트 (Vercel Functions 의 한계가 있으면 별도 ws 서버 또는 long-poll 대안 검토)
- [ ] daemon 측 hook 응답 캐시 (TTL 60초, push 받으면 무효화)
- [ ] 파일 watcher (chokidar) — `.claude/`, `CLAUDE.md`, `.mcp.json` 변경 감지 → API push
- [ ] mytool-cli 의 SessionStart/PreToolUse/Stop hook 이 daemon 있으면 daemon, 없으면 직접 API 호출 (auto-fallback)
- 검증:
  - daemon ON 상태에서 PreToolUse latency p95 < 100ms 확인
  - daemon OFF 로 돌려도 모든 기능 동작 (auto-fallback)
  - API 1분간 다운 시켜도 stale 캐시로 60초 버틴 후 default allow

### PR 12+ — Memory 축 구현 (TBD, PR 11 후 결정)
- [ ] CLAUDE.md / AGENTS.md 의 web 편집기 (Monaco)
- [ ] 변경 시 daemon 통해 사용자 PC 파일 동기화
- [ ] 버전 히스토리 (mytool DB 에 스냅샷 보관)
- [ ] 템플릿 라이브러리
- [ ] 정체성 재정립 (README, package.json description 변경)

> Memory 축은 daemon 이 갖춰진 뒤에야 자연스럽다. PR 11 끝나고 실제 사용해본 뒤 우선순위 재평가.

**총 예상 시간**:
- PR 1~10: 약 9~10 작업일 (워크스페이스 비전과 무관하게 이미 합의된 범위)
- PR 11: 1.5~2일 추가
- PR 12+: TBD

**현실적 권장 마일스톤**:
- M1 (PR 1~3, 약 3일): Skills 축 1차 완성. Settings 페이지에서 스킬 이전 가능.
- M2 (PR 4~6, 약 3.5일): Execution 축 1차 완성. Harness 자동 사이클 돌아감.
- M3 (PR 7~10, 약 3일): hook 강제 + 인사이트 결합. 현재 비전의 1차 마침표.
- M4 (PR 11, 약 2일): daemon 도입. latency 개선 + Memory 축 준비.
- M5 (PR 12+): Memory 축 + 정체성 재정립. 시점 미정.

## 9. 호환성·이전 전략

- **claude-sync repo**: 코드를 mytool 로 이전한 뒤에도 별도 repo 는 살려두되 README 에 "메인 개발은 mytool 모노레포로 이동" 안내. v0.1.0 태그 후 archived 처리.
- **claude-harness repo**: 동일.
- **기존 사용자**: 거의 본인 1명이라 마이그레이션 부담 없음. CLI 의 명령어 형태는 유지 (`harness run`, `claude-sync export`).

## 10. 결정 보류 사항

- **백엔드 프레임워크 (Hono vs NestJS)**: 현재 Hono 유지. M1 (PR 1~3) 끝난 뒤 사용자님이 작업 속도·답답함 등을 평가해서 마이그레이션 여부 결정. 미리 결정하지 않음.
- **SaaS 모드 (원격 스캔)**: 1단계는 셀프호스팅 가정. 팀에 공유할 단계가 오면 cli 가 스냅샷 push/pull 하는 흐름으로 확장.
- **harness 의 Claude Code 호출 환경**: API 가 spawn 한 subprocess 가 어떤 cwd, 어떤 user 로 도는지 (셀프호스팅 docker 컨테이너 내부면 git/claude 바이너리 마운트 필요). compose 파일 수정 가능성 있음.
- **Web 인증과 harness CLI**: web 세션과 harness 의 reportToken 은 분리. token 은 1회용·short-lived.

### 10a. 결정된 사항 (2026-05-07, v2 갱신)

- **Claude Code 와의 통합 방식**: hook 3종 (SessionStart / PreToolUse / Stop). CLAUDE.md 자동 편집 안 함. → §3a
- **mytool 다운 시 동작**: fail-open. hook 이 짧은 timeout 후 default allow → Claude Code 일반 동작. → §3a.5
- **강제 수준**: 정보 전달뿐 아니라 PreToolUse 로 도구 호출 차단/수정까지. → §3a.2
- **mytool 호스팅**: Supabase + Vercel (일본 리전) 에 상시 배포. cold start 완화 위한 keep-alive 필요. → §11
- **SLA**: 일본 서버 latency 고려해 SessionStart 800ms / PreToolUse 500ms / Stop async. daemon 도입 시 100ms 이내로 단축. → §3a, §6.1a
- **정체성 재정립**: 4축 워크스페이스 비전 채택 (Memory · Skills · Execution + Observability backbone). 단, **PR 1~10 까지는 정체성 재정립 작업 없이 그대로 진행**, PR 11 끝난 뒤 README/description 갱신 검토. → §0
- **cli daemon 도입**: PR 11 로 추가. Vercel 호스팅 + Memory 축 구현을 위해 사실상 필수. 단 daemon 없이도 모든 기능은 fallback 으로 동작. → §3a.7, PR 11

## 11. 위험과 완화

| 위험 | 완화책 |
| --- | --- |
| Python·Node 모노레포 빌드 복잡 | turbo task shim + CI 에 두 런타임 모두 설치. 실패해도 sync/api/web 빌드는 무관하게 진행. |
| sync 가 마운트되지 않은 사용자 PC 의 파일을 못 봄 | 1단계는 셀프호스팅(api 가 사용자 PC 에서 직접 동작) 가정. SaaS 모드는 future work. |
| harness 가 무한 루프 | 기존 max_iterations 유지 + mytool 측에서 timeout + abort 라우트 |
| 시크릿 누출 (`.mcp.json` 의 비밀번호) | sync 의 마스킹 옵션을 export/copy 시 기본 ON. 마스킹된 데이터에는 manifest 에 플래그. |
| PreToolUse hook 이 응답 늦으면 사용자 작업 멈춤 | 200ms timeout 후 default allow. mytool API p95 모니터링. Vercel 의 cold start 를 keep-alive ping 으로 완화. |
| mytool API 다운 시 강제 규칙이 풀림 | 의도된 동작 (fail-open). 사용자가 작업 못 하는 것보다 강제가 잠깐 풀리는 게 낫다. 규칙이 풀려 있을 때 web 대시보드에 명확히 표시. |
| PreToolUse hook 으로 도구 인자가 mytool 에 전송됨 (개인정보) | 서버측에 평문 저장 안 함, 결정·rule_id 만 로깅. mask 로직 hook 페이로드에도 적용. CliToken 으로 인증. |
| daemon 이 사용자 PC 의 파일을 자동 변경 (CLAUDE.md 등) | 모든 파일 변경은 web 의 명시 액션 트리거 + diff 미리보기 + 자동 백업 (`.bak.<ts>`). 변경 로그를 daemon이 로컬 보관 (`~/.mytool/audit.log`). |
| Vercel Serverless 의 WebSocket 미지원 | 별도 ws 서버 (Cloudflare Workers / Fly.io 의 작은 인스턴스) 운영, 또는 long-polling fallback. PR 11 시작 전 PoC 필수. |

## 12. 다음 액션

1. **이 v2 문서 리뷰** → §0 비전, §3a.7 daemon, PR 11 부분 특히
2. **(선택) Vercel WebSocket PoC** — PR 11 시작 전에 Vercel Functions 의 ws 한계 확인. Long-poll 또는 별도 ws 서버 결정.
3. **PR 1 시작** — Project 모델에 `syncEnabled`/`harnessEnabled` 토글 추가. 가장 작은 단위, 즉시 가치 검증.
4. **각 마일스톤 후 짧은 회고** — M1, M2, M3 마칠 때마다 다음 단계 우선순위·범위 재조정.
5. **M3 (PR 10) 끝난 시점 평가**:
   - 실제 사용해보면서 daemon 의 가치가 PR 11 만큼 시급한지
   - Memory 축이 진짜 필요한지 (사용자님 작업 패턴 기반)
   - 정체성 재정립 (README/description 변경) 시점

---

**참고 자료**:
- 현재 mytool 구조: `mytool/PROGRESS.md`
- claude-sync 라이브러리: `C:\git\personal\claude-sync\src\`
- claude-harness phases: `C:\git\personal\claude-harness\claude_harness\phases\`
