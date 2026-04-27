CREATE TABLE "project_tool_baselines" (
  "id"          TEXT NOT NULL,
  "projectId"   TEXT NOT NULL,
  "toolName"    TEXT NOT NULL,
  "p50Ms"       INTEGER NOT NULL,
  "p95Ms"       INTEGER NOT NULL,
  "sampleCount" INTEGER NOT NULL,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_tool_baselines_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "project_tool_baselines"
  ADD CONSTRAINT "project_tool_baselines_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON UPDATE CASCADE ON DELETE CASCADE;

CREATE UNIQUE INDEX "project_tool_baselines_projectId_toolName_key"
  ON "project_tool_baselines"("projectId", "toolName");

CREATE INDEX "project_tool_baselines_projectId_idx"
  ON "project_tool_baselines"("projectId");
