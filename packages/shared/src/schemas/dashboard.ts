import { z } from "zod";

export const DateRangeQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  userId: z.string().optional(),
});
export type DateRangeQuery = z.infer<typeof DateRangeQuerySchema>;

export const DashboardSummarySchema = z.object({
  totalSessions: z.number().int(),
  activeUsers: z.number().int(),
  totalInputTokens: z.number().int(),
  totalOutputTokens: z.number().int(),
  totalCacheReadTokens: z.number().int(),
  totalCacheCreationTokens: z.number().int(),
  estimatedCostUsd: z.number(),
  topSkills: z.array(
    z.object({
      skillName: z.string(),
      callCount: z.number().int(),
    }),
  ),
  topAgentTypes: z.array(
    z.object({
      agentType: z.string(),
      callCount: z.number().int(),
    }),
  ),
  outliersByTool: z.array(
    z.object({
      toolName: z.string(),
      occurrences: z.number().int(),
      avgDurationMs: z.number().int(),
      maxDurationMs: z.number().int(),
    }),
  ),
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;

export const UsagePointSchema = z.object({
  date: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheCreationTokens: z.number().int(),
  estimatedCostUsd: z.number(),
});
export type UsagePoint = z.infer<typeof UsagePointSchema>;

export const UsageSeriesSchema = z.object({
  series: z.array(UsagePointSchema),
});
export type UsageSeries = z.infer<typeof UsageSeriesSchema>;

export const SkillStatSchema = z.object({
  skillName: z.string(),
  callCount: z.number().int(),
  uniqueUsers: z.number().int(),
  lastCalledAt: z.string().datetime().nullable(),
});
export type SkillStat = z.infer<typeof SkillStatSchema>;

export const AgentStatSchema = z.object({
  agentType: z.string(),
  callCount: z.number().int(),
  uniqueUsers: z.number().int(),
  descriptions: z.array(z.string()),
  lastCalledAt: z.string().datetime().nullable(),
});
export type AgentStat = z.infer<typeof AgentStatSchema>;

export const SessionListItemSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string().nullable(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  eventCount: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  estimatedCostUsd: z.number(),
  outlierCount: z.number().int().nullable(),
  outlierRatio: z.number().nullable(),
});
export type SessionListItem = z.infer<typeof SessionListItemSchema>;

export const SessionListSchema = z.object({
  sessions: z.array(SessionListItemSchema),
  total: z.number().int(),
});
export type SessionList = z.infer<typeof SessionListSchema>;

export const UsageBreakdownItemSchema = z.object({
  model: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadInputTokens: z.number().int(),
  cacheCreationInputTokens: z.number().int(),
  estimatedCostUsd: z.number(),
  isSubagent: z.boolean(),
});
export type UsageBreakdownItem = z.infer<typeof UsageBreakdownItemSchema>;

export const SessionDetailSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string().nullable(),
  projectId: z.string(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  eventCount: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadInputTokens: z.number().int(),
  cacheCreationInputTokens: z.number().int(),
  estimatedCostUsd: z.number(),
  usageByModel: z.array(UsageBreakdownItemSchema),
});
export type SessionDetail = z.infer<typeof SessionDetailSchema>;

export const EventItemSchema = z.object({
  id: z.string(),
  hookEventName: z.string(),
  toolName: z.string().nullable(),
  toolInput: z.string().nullable(),
  toolResponse: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  isSkillCall: z.boolean(),
  skillName: z.string().nullable(),
  isAgentCall: z.boolean(),
  agentType: z.string().nullable(),
  agentDesc: z.string().nullable(),
  isSlashCommand: z.boolean(),
  slashCommandName: z.string().nullable(),
  timestamp: z.string().datetime(),
});
export type EventItem = z.infer<typeof EventItemSchema>;

export const EventListSchema = z.object({
  events: z.array(EventItemSchema),
  total: z.number().int(),
});
export type EventList = z.infer<typeof EventListSchema>;
