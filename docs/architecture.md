# mytool — Architecture

> Claude Code observability for individuals and small teams.

## Overview

mytool은 4개 패키지로 구성된 pnpm 모노레포입니다.

```
[Claude Code]
    │
    │  hooks (SessionStart / PreToolUse / PostToolUse / Stop / SubagentStop)
    ▼
[CLI: mytool hook]            ─── 개발자 머신
    │
    │  HTTPS POST /api/events  (3s timeout, fire-and-forget)
    ▼
[API: Hono + Prisma]          ─── 자체호스팅 서버
    │
    ▼
[PostgreSQL]
    ▲
    │  HTTPS (Bearer JWT)
    │
[Web: Next.js Dashboard]      ─── 자체호스팅 또는 같은 서버
```

## Packages

| 패키지 | 역할 | 주요 의존성 |
|--------|------|-------------|
| `@mytool/shared` | 모든 패키지가 import하는 타입 + Zod 스키마 + 가격 상수 | zod |
| `@mytool/api` | 이벤트 수집·인증·집계 API | hono, @prisma/client, jose, bcrypt |
| `@mytool/web` | 대시보드 UI | next 15, react 19, recharts |
| `mytool-ai` (CLI) | 사용자 머신에 설치되는 CLI | commander, @inquirer/prompts |

의존성 규칙:
- `cli` / `api` / `web` → 모두 `shared`만 직접 import
- `cli` ↔ `api`, `web` ↔ `api`는 HTTP만 (빌드 의존성 없음)

## Argos와의 차이점 (의도적 단순화)

| 항목 | Argos | mytool |
|------|-------|--------|
| 인증 (Web) | Auth.js v5 + Credentials provider | httpOnly 쿠키 + JWT 직접 처리 |
| DB 연결 | Supabase의 `DIRECT_URL` 분리 | 단일 `DATABASE_URL` |
| Docker Compose | Postgres만 정의 | Postgres + API + Web 모두 정의 |
| 배포 가정 | Railway + Vercel + Supabase | 셀프호스팅 우선 |
| Stale 도메인 자동 마이그레이션 | 있음 (argos-ai.xyz → 기본값) | 없음 (불필요) |
| 데이터 모델 | 동일 | 동일 (Argos PRD를 참고) |

이 차이점들은 모두 **자체호스팅 단순성**과 **개인/소규모 팀 사용성**을 위한 결정입니다.

## Data flow: Hook event 처리

1. Claude Code가 hook 이벤트 발생 시 `mytool hook` 프로세스 spawn하고 stdin으로 JSON 전달
2. `mytool hook`이 stdin을 100ms 안에 읽고 파싱
3. `.mytool/project.json`을 상위 디렉터리 탐색으로 찾음
4. `~/.mytool/config.json`에서 JWT 로드
5. 이벤트 타입별 처리:
   - **SessionStart**: transcript 읽어 slash command (`/commit` 등) 감지
   - **PreToolUse / PostToolUse**: tool_input/tool_response를 2000자로 truncate
   - **Stop / SubagentStop**: transcript에서 모든 `assistant` 항목의 `usage` 합산
6. `POST /api/events` 호출 (3초 timeout)
7. **항상 exit 0**으로 종료 — 어떤 실패도 사용자 작업 차단 금지

## API endpoints

```
POST   /api/auth/register      회원가입 + 개인 org 자동 생성
POST   /api/auth/login         로그인
DELETE /api/auth/session       현재 토큰 revoke (logout)
GET    /api/auth/me            현재 사용자 + 소속 org
GET    /api/auth/sessions      내 모든 활성/비활성 토큰 목록
DELETE /api/auth/sessions/:id  특정 토큰 revoke (다른 디바이스 로그아웃)

POST   /api/orgs                  새 org 생성
GET    /api/orgs/:id              org 정보
GET    /api/orgs/:id/projects     org의 프로젝트 목록

POST   /api/projects              새 프로젝트 생성
GET    /api/projects/:id          프로젝트 정보

POST   /api/events                Hook 이벤트 수집 (고빈도, rate-limited)

GET    /api/projects/:id/dashboard/summary    KPI 카드 + Top skills/agents
GET    /api/projects/:id/dashboard/usage      일별 토큰·비용 시계열
GET    /api/projects/:id/dashboard/sessions   세션 목록
```

## Database schema

10개 테이블:
- **users / org_memberships / organizations**: 인증·팀
- **projects**: org 소속 코드 저장소 단위
- **claude_sessions**: Claude Code의 session_id를 그대로 PK로
- **events**: 모든 hook 발화 (`isSkillCall` 등 파생 필드 포함)
- **usage_records**: 토큰·비용 (Stop/SubagentStop 시점에 1건씩)
- **messages**: 세션 전사 (선택, 50000자 truncate)
- **cli_tokens**: JWT의 SHA-256 해시 + `kind`(WEB/CLI) + `label` + `lastUsedAt` (revocation/세션 관리용)

자세한 정의: `packages/api/prisma/schema.prisma`

## Truncation limits

| 데이터 | 한도 | 이유 |
|--------|------|------|
| `tool_input`, `tool_response` | 2000자 | 페이로드 폭주 방지 |
| `Message.content` (세션 전사) | 50000자 | DB 사이즈 관리 |
| `agent_desc` | 500자 | 표시용으로 충분 |

## 보안

### 인증 기본
- **비밀번호**: bcrypt 12 rounds로 해시 저장
- **JWT 비밀키**: 최소 32자 환경변수 (`JWT_SECRET`)
- **CliToken**: 평문 JWT 저장 안 함, SHA-256 해시만 저장
- **CORS**: `WEB_URL` 환경변수로 명시한 출처만 허용
- **httpOnly 쿠키**: Web에서는 JavaScript에서 토큰 접근 불가

### 토큰 종류 분리 (Web vs CLI)
- **Web 세션**: 7일 만료. 쿠키 maxAge도 동일하게 7일.
- **CLI 토큰**: 365일 만료. 매번 로그인하지 않아도 됨.
- 클라이언트는 로그인 시 `kind: "web" | "cli"`를 명시. JWT에도 kind 클레임이 들어감.
- 레거시(누락) 토큰은 안전하게 web으로 간주.
- 즉시 무효화는 `cli_tokens.revokedAt` 컬럼 — DB UPDATE로 끝.

### Rate limiting
메모리 기반 sliding-window 미들웨어 (`middleware/rate-limit.ts`).
- `/api/auth/login`, `/api/auth/register`: IP당 분당 5회 (무차별 대입 방어)
- `/api/auth/me`: 사용자당 분당 60회
- `/api/events`: 사용자당 분당 600회 (정상 hook 발화의 ~10배 여유)

단일 프로세스에서만 동작합니다. 다중 인스턴스 배포 시 Redis 등 공유 저장소로 교체 필요.

### 세션 관리 UI
- `/settings/sessions` — 사용자가 자신의 토큰 목록 조회 가능 (web/cli 구분 표시)
- 각 토큰: 라벨(자동 감지된 브라우저/CLI 이름), 생성 시각, 마지막 사용 시각, 만료 시각
- "이 디바이스" 표시 — 현재 사용 중인 토큰 식별
- Revoke 버튼 — 즉시 다른 디바이스 로그아웃
- `lastUsedAt`는 60초 throttle로 갱신 (모든 요청마다 DB write 방지)

## 확장 포인트 (MVP 이후)

- 프로젝트별 사용량 알림 (Slack webhook)
- 세션 상세 페이지 + 전사 뷰어
- AI 인사이트 (반복 패턴 → 스킬 추천)
- WebSocket 실시간 푸시 (현재는 페이지 새로고침)
- OpenTelemetry 통합 (조직용)
- 비밀번호 리셋 / 이메일 검증 (현재는 미구현)
- CSRF 토큰 (현재는 SameSite=Lax 단독)
- 다중 인스턴스 배포 시 Redis 기반 rate limit

## 로컬 개발

```bash
pnpm install
cp .env.example .env  # JWT_SECRET, AUTH_SECRET 채우기
pnpm db:up            # Postgres 컨테이너
pnpm db:migrate       # 첫 마이그레이션
pnpm dev              # api(3001) + web(3000) 동시 실행

# CLI 빌드 + 로컬 사용
pnpm --filter mytool-ai build
node packages/cli/dist/index.js --api-url http://localhost:3001
```

## 셀프호스팅

```bash
docker compose --profile full up -d
# → Postgres + API + Web 모두 실행
```

CLI를 본인 인스턴스로 향하게:
```bash
mytool --api-url https://mytool.example.com
```
