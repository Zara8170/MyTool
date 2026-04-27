-- Remove slowestTool columns from claude_sessions
ALTER TABLE "claude_sessions"
  DROP COLUMN IF EXISTS "slowestToolName",
  DROP COLUMN IF EXISTS "slowestToolMs";

-- Create session_outlier_events table
CREATE TABLE IF NOT EXISTS "session_outlier_events" (
  "id"         TEXT NOT NULL,
  "sessionId"  TEXT NOT NULL,
  "projectId"  TEXT NOT NULL,
  "toolName"   TEXT NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "medianMs"   INTEGER NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "session_outlier_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "session_outlier_events"
  ADD CONSTRAINT "session_outlier_events_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "claude_sessions"("id")
    ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "session_outlier_events"
  ADD CONSTRAINT "session_outlier_events_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id")
    ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "session_outlier_events_projectId_toolName_idx"
  ON "session_outlier_events"("projectId", "toolName");

CREATE INDEX IF NOT EXISTS "session_outlier_events_sessionId_idx"
  ON "session_outlier_events"("sessionId");
