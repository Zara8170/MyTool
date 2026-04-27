CREATE TABLE "daily_project_stats" (
  "id"                  TEXT NOT NULL,
  "projectId"           TEXT NOT NULL,
  "date"                DATE NOT NULL,
  "sessionCount"        INTEGER NOT NULL DEFAULT 0,
  "activeUsers"         INTEGER NOT NULL DEFAULT 0,
  "inputTokens"         BIGINT NOT NULL DEFAULT 0,
  "outputTokens"        BIGINT NOT NULL DEFAULT 0,
  "cacheReadTokens"     BIGINT NOT NULL DEFAULT 0,
  "cacheCreationTokens" BIGINT NOT NULL DEFAULT 0,
  "estimatedCostUsd"    DECIMAL(14,6) NOT NULL DEFAULT 0,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_project_stats_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "daily_project_stats"
  ADD CONSTRAINT "daily_project_stats_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON UPDATE CASCADE ON DELETE CASCADE;

CREATE UNIQUE INDEX "daily_project_stats_projectId_date_key"
  ON "daily_project_stats"("projectId", "date");

CREATE INDEX "daily_project_stats_projectId_date_idx"
  ON "daily_project_stats"("projectId", "date");
