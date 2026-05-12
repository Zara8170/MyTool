# @mytool/harness

Claude Code 로 구동되는 자율 개발 하네스. `harness.yaml` 에 요구사항을 작성하면 Claude 가 자동으로 구현 → 검증 → 커밋(또는 롤백)을 반복합니다.

> 이 패키지는 mytool 모노레포의 일부지만 **Python (pnpm 미참여)** 입니다. pyproject 로 빌드·테스트하고, mytool API 가 subprocess 로 실행해서 진행 상황을 HTTP 로 보고받는 구조입니다 (`--report-url` / `--report-token` 옵션).

## 설치

```bash
# 모노레포 루트에서
pip install -e packages/harness
```

요구사항: Python 3.11+, `claude` CLI, 대상 프로젝트가 git 저장소.

## 빠른 시작

```bash
# 1. 대상 프로젝트에서 초기화
cd ~/projects/my-project
harness init

# 2. harness.yaml 편집 후 실행
harness run
```

## harness.yaml 예시

```yaml
project: my-project
verify_cmd: "npm run build && npm test"

requirements:
  - id: req-001
    title: "사용자 로그인 API"
    description: "JWT 기반 로그인 엔드포인트"
    status: pending
  - id: req-002
    title: "대시보드 페이지"
    status: pending
```

## 이터레이션 사이클

```
Ideation → Build → Verify → Report → (반복)
```

1. **Ideation** — `pending` 요구사항 하나 선택
2. **Build** — `claude -p` 로 구현 요청 (git HEAD 저장)
3. **Verify** — `verify_cmd` 실행
4. **Report** — pass: `status: done` + git commit / fail: `git reset --hard` + `status: failed`

## mytool 통합 (선택)

mytool API 에서 spawn 한 경우 `--report-url`, `--report-token` 옵션이 자동으로 붙어 phase 전이마다 HTTP POST 로 진행 상황이 보고됩니다.

```bash
harness run \
  --report-url=https://mytool.example.com/api/harness/runs/<runId>/events \
  --report-token=<run scoped bearer>
```

옵션을 비우면 기존처럼 stdout 만 사용합니다 (mytool 미연동 단독 사용).

## 테스트

```bash
# packages/harness 에서
python -m pytest -q
```

모노레포 루트의 `pnpm test` 도 `@mytool/harness` 의 turbo task 를 통해 pytest 를 호출합니다 (Python 3.11+ 필요).

## 적용 가능한 프로젝트

- 백엔드 API (Express, FastAPI, Hono 등)
- CLI 도구
- 라이브러리
- 빌드 + 자동화 테스트가 있는 모든 프로젝트
