# mytool

> Claude Code observability for individuals and small teams.

Claude Code의 모든 도구 호출, 토큰 사용량, 비용을 추적하고 시각화하는 셀프호스팅 옵저버빌리티 도구입니다.

## What it tracks

- **프롬프트별 토큰 사용량** — input/output/cache_read/cache_write
- **도구·스킬 호출** — 어떤 도구가 언제, 얼마나 자주 호출되는지
- **세션 타임라인** — 한 세션에서의 도구 시퀀스와 소요 시간
- **비용 추정** — 모델별 단가 기반 누적 비용

## Quick start (local development)

```bash
# 1. 의존성 설치
pnpm install

# 2. 환경변수 설정
cp .env.example .env
# .env 파일을 열어 JWT_SECRET, AUTH_SECRET 등 채우기

# 3. DB 실행
pnpm db:up

# 4. DB 마이그레이션
pnpm db:migrate

# 5. 전체 개발 서버 실행
pnpm dev
# → API:  http://localhost:3001
# → Web:  http://localhost:18100

# 6. CLI 로컬 테스트
pnpm --filter @mytool/cli build
node packages/cli/dist/index.js --api-url http://localhost:3001
```

## 개별 실행 (프론트엔드 / 백엔드 분리)

전체 스택 대신 프론트엔드나 백엔드만 따로 띄울 수 있습니다.

### 백엔드 (API)

```bash
# 개발 서버 (hot-reload)
pnpm --filter @mytool/api dev
# → http://localhost:3001

# 프로덕션 빌드 후 실행
pnpm --filter @mytool/api build
pnpm --filter @mytool/api start
```

### 프론트엔드 (Web)

```bash
# 개발 서버 (hot-reload)
pnpm --filter @mytool/web dev
# → http://localhost:18100

# 프로덕션 빌드 후 실행
pnpm --filter @mytool/web build
pnpm --filter @mytool/web start
```

> 프론트엔드는 백엔드 API에 의존합니다. 백엔드와 DB가 먼저 실행 중이어야 합니다.

## Self-hosting (production)

```bash
# 환경변수 설정 (필수: JWT_SECRET, AUTH_SECRET, POSTGRES_PASSWORD)
cp .env.example .env

# 전체 스택 실행 (Postgres + API + Web)
docker compose --profile full up -d

# CLI 설치 (개발자 머신에서)
npm install -g mytool-ai
mytool --api-url https://your-mytool-instance.example.com
```

## Architecture

```
[Claude Code]
    └─ hooks → [CLI: mytool hook]
                      ↓ HTTPS POST
              [API: Hono + Prisma]
                      ↓
              [PostgreSQL]
                      ↑
              [Web: Next.js Dashboard]
```

자세한 설계는 [docs/architecture.md](./docs/architecture.md) 참고.

## License

MIT
