import { z } from "zod";

/**
 * Claude Code Hook 이벤트 타입.
 * https://docs.claude.com/en/docs/agents-and-tools/claude-code/hooks
 */
export const HookEventNameSchema = z.enum([
  "SessionStart",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStop",
  "UserPromptSubmit",
  "Notification",
]);
export type HookEventName = z.infer<typeof HookEventNameSchema>;

/**
 * Stop 이벤트에서 transcript 파싱 후 추출되는 토큰 사용량.
 * Claude Code transcript JSONL의 type=="assistant" 항목 message.usage 합산값.
 */
export const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative().default(0),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  model: z.string().nullable().optional(),
  isSubagent: z.boolean().default(false),
});
export type Usage = z.infer<typeof UsageSchema>;

/**
 * CLI(mytool hook)가 API로 전송하는 이벤트 페이로드.
 * 한 hook 발화당 한 번 POST됩니다.
 */
export const IngestEventSchema = z.object({
  /** 프로젝트 식별자 (.mytool/project.json의 projectId) */
  projectId: z.string().min(1),

  /** Claude Code 세션 ID */
  sessionId: z.string().min(1),

  /** transcript.jsonl 절대 경로 (Stop/SubagentStop에서 토큰 추출용) */
  transcriptPath: z.string().optional(),

  /** Hook 이벤트 종류 */
  hookEventName: HookEventNameSchema,

  /** 도구 이름 (PreToolUse/PostToolUse만 해당) */
  toolName: z.string().optional(),

  /** 도구 입력 (JSON 문자열, 2000자로 truncate된 상태) */
  toolInput: z.string().optional(),

  /** 도구 출력 (PostToolUse만 해당, 2000자 truncate) */
  toolResponse: z.string().optional(),

  /** 도구 실행 종료 코드 */
  exitCode: z.number().int().optional(),

  /** Slash 커맨드 호출 여부 (CLI가 transcript 분석 후 채움) */
  isSlashCommand: z.boolean().optional(),

  /** Slash 커맨드 이름 (e.g. "/commit" → "commit") */
  slashCommandName: z.string().optional(),

  /** 서브에이전트 식별 (SubagentStop에서 추출) */
  agentId: z.string().optional(),

  /** Stop/SubagentStop 시 transcript에서 추출한 토큰 사용량 */
  usage: UsageSchema.optional(),

  /** 이벤트 발생 시각 (ISO 8601) */
  timestamp: z.string().datetime(),

  /** 디버깅용 원본 페이로드 보존 (선택, 알 수 없는 필드 backfill용) */
  rawPayload: z.record(z.unknown()).optional(),
});
export type IngestEvent = z.infer<typeof IngestEventSchema>;

export const MessageItemSchema = z.object({
  role: z.enum(["human", "assistant"]),
  content: z.string().max(50_000),
  timestamp: z.string().datetime(),
});
export type MessageItem = z.infer<typeof MessageItemSchema>;

export const MessageBatchSchema = z.object({
  messages: z.array(MessageItemSchema).max(2000),
});
export type MessageBatch = z.infer<typeof MessageBatchSchema>;

/**
 * Truncation 한도. 페이로드 폭주 방지.
 */
export const TRUNCATION_LIMITS = {
  /** tool_input, tool_response */
  toolPayload: 2000,
  /** Message.content (세션 전사) */
  messageContent: 50_000,
} as const;

/**
 * 문자열을 안전하게 truncate. 길면 "...[truncated]" 표시.
 */
export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  const suffix = "...[truncated]";
  return input.slice(0, max - suffix.length) + suffix;
}
