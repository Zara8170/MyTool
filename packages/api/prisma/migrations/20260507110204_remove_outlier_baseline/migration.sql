-- Remove outlier and baseline tables and columns

-- Drop session_outlier_events table
DROP TABLE IF EXISTS "session_outlier_events";

-- Drop project_tool_baselines table
DROP TABLE IF EXISTS "project_tool_baselines";

-- Drop outlier columns from claude_sessions
ALTER TABLE "claude_sessions"
  DROP COLUMN IF EXISTS "outlierCount",
  DROP COLUMN IF EXISTS "outlierRatio";
