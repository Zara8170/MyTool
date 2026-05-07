# 세션 리캡 — 2026-05-07

## 1. 한 줄 요약

claude-sync 단독 도구 완성 후, mytool 의 정체성을 "옵저버빌리티" 에서 "Claude Code 워크스페이스" 로 재정립하는 통합 설계를 완성하고 PR 1 (Project 토글 + UI) 까지 구현.

## 2. 결정된 사항

### 2.1 정체성 — 4축 워크스페이스
- mytool 은 Memory · Skills · Execution + Observability(backbone) 네 축으로 재구성
- 옵저버빌리티는 죽이지 않음. 다른 3축에 인사이트를 공급하는 backbone 으로 강등
- 정체성 변경 (README/description) 은 PR 10 끝난 뒤에. 그 전까지는 기능 추가에 집중

### 2.2 Claude Code 와의 연동 — hook 3종
- **SessionStart**: 컨텍스트 주입 (현재 토글 상태, 진행 중 요구사항). SLA 800ms
- **PreToolUse**: 행동 강제 (verify 통과 후 commit, force push 차단 등). SLA 500ms
- **Stop**: 사이클 마무리 (phase 전이 기록). 비동기

### 2.3 fail-open 원칙
- mytool API 가 죽거나 느리면 hook 이 default `allow` 로 빠짐
- 사용자 작업이 mytool 의 가용성에 인질 잡히지 않음
- daemon 모드 (PR 11) 도입 시 stale 캐시로 60초까지 버팀

### 2.4 Hono 유지 (NestJS 마이그레이션 보류)
- Hono 자체는 다중 사용자에 충분. 진짜 문제는 인프라·운영 영역
- M1 (PR 2~3) 끝난 뒤 재평가. 그때도 객관적 신호 없으면 그대로

### 2.5 호스팅
- Vercel + Supabase (일본 리전). 상시 배포
- WebSocket 한계 → PR 11 시작 전 PoC 필요 (Cloudflare DO / Fly.io / Long-poll / Supabase Realtime 중 택일)

### 2.6 Python harness — 모노레포에 흡수, 단 격리
- `packages/harness` 신설. pnpm 워크스페이스에는 비참여 (명시 목록으로 제외)
- turbo task shim 으로 빌드/테스트만 통합
- mytool API 와 통신은 HTTP report 패턴 (`harness run --report-url`)

## 3. 진행 상태

- PR 1 ✅ 코드 작성 완료. 사용자님 검증 대기
- PR 2~11: 미착수
- 마일스톤 그루핑: M1=PR 2+3, M2=PR 4+5+6, M3=PR 7+8+9+10, M4=PR 11

## 4. 다음 세션 시작 시 액션

```
1. integration-plan.md §0 (비전), §3a (hook), §10a (결정사항), §8 (PR 단계) 훑어보기
2. progress-log.md 읽기
3. 사용자님께 PR 1 검증 결과 묻기
4. OK 면 M1 (PR 2 + PR 3) 시작
```

## 5. sandbox 환경 메모 (다음 세션 참고)

- 마운트된 폴더 (`C:\git\personal\*` 등) 의 파일에 Edit/Write 툴이 만든 결과 끝에 NULL 패딩이 붙음
- 큰 파일 수정 시 끝부분이 잘릴 수 있음 → `cat heredoc` 으로 새로 쓰는 게 가장 안전
- mv 가 cross-device 라 실패할 수 있으므로 `cat src > dest` 패턴 사용
- git diff 가 CRLF→LF 차이로 무관한 파일도 modified 로 보일 수 있음. `git diff --ignore-cr-at-eol` 로 진짜 변경만 확인

## 6. 미해결 / 결정 보류

- 백엔드 프레임워크 (Hono vs NestJS) — M1 끝난 뒤 재검토
- SaaS vs 셀프호스팅 — 1단계는 셀프호스팅 가정. 팀 공유 단계 가면 cli push/pull 추가
- WebSocket 호스팅 옵션 — PR 11 직전 PoC
- Memory 축 (PR 12+) 우선순위 — PR 11 이후 사용 패턴 보고 결정
