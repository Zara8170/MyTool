-- mytool 통합 플랜 PR 1: Project 토글 필드 추가
-- §0 4축 워크스페이스 비전 — Skills/Execution 축 ON/OFF 인프라

ALTER TABLE "projects"
  ADD COLUMN "syncEnabled"    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "harnessEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "harnessConfig"  JSONB;
