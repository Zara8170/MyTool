/**
 * mytool hook
 *
 * Claude Code가 hook 이벤트마다 spawn하는 내부 명령어입니다.
 *
 * 절대 규칙:
 *   - 어떤 일이 있어도 exit 0으로 종료 (Claude Code 작업 흐름 차단 금지)
 *   - stdin 읽기 100ms 타임아웃 (TTY에서 즉시 종료)
 *   - API 요청 3초 타임아웃 (서버 다운 시에도 빠르게 포기)
 *   - 모든 에러는 silent ~ MYTOOL_DEBUG=1일 때만 ~/.mytool/hook-debug.log
 */
import {
  IngestEventSchema,
  TRUNCATION_LIMITS,
  truncate,
  type IngestEvent,
  type Usage,
} from "@mytool/shared";
import { api } from "../lib/api-client.js";
import { readConfig, resolveApiUrl } from "../lib/config.js";
import { debugLog } from "../lib/debug.js";
import { findProjectConfig } from "../lib/project.js";
import { readStdinWithTimeout } from "../lib/stdin.js";
import {
  detectSlashCommand,
  extractUsageFromTranscript,
  readTranscriptMessages,
} from "../lib/transcript.js";

interface ClaudeHookPayload {
  hook_event_name?: string;
  session_id?: string;
  transcript_path?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  exit_code?: number;
  agent_id?: string;
  agent_transcript_path?: string;
  [key: string]: unknown;
}

export async function hookCommand(): Promise<void> {
  try {
    await runHook();
  } catch (err) {
    debugLog("hookCommand top-level error", err);
  }
  // 항상 exit 0
  process.exit(0);
}

async function runHook(): Promise<void> {
  // 1. stdin 읽기 (100ms 타임아웃)
  const raw = await readStdinWithTimeout(100);
  if (!raw) {
    debugLog("no stdin received");
    return;
  }

  let payload: ClaudeHookPayload;
  try {
    payload = JSON.parse(raw) as ClaudeHookPayload;
  } catch (err) {
    debugLog("invalid JSON on stdin", err);
    return;
  }

  if (!payload.hook_event_name || !payload.session_id) {
    debugLog("missing hook_event_name or session_id");
    return;
  }

  // 2. 프로젝트 설정 찾기
  const projectInfo = findProjectConfig(process.cwd());
  if (!projectInfo) {
    debugLog("no .mytool/project.json found");
    return;
  }

  // 3. 사용자 인증 정보
  const config = readConfig();
  if (!config) {
    debugLog("no ~/.mytool/config.json (not logged in)");
    return;
  }

  // 4. 페이로드 빌드
  const apiUrl = resolveApiUrl(
    undefined,
    projectInfo.config.apiUrl,
    config.apiUrl,
  );

  const event = await buildEventPayload(
    payload,
    projectInfo.config.projectId,
  );
  if (!event) {
    debugLog("failed to build event payload");
    return;
  }

  // 5. API 전송 (3초 hard timeout, fire-and-forget)
  try {
    await api.sendEvent(apiUrl, config.token, event);
    debugLog(`event sent: ${event.hookEventName} ${event.toolName ?? ""}`);
  } catch (err) {
    debugLog(`failed to send event ${event.hookEventName}`, err);
    // 절대 throw하지 않음
  }

  // 6. Stop 이벤트면 transcript 메시지 전송 (fire-and-forget, 실패해도 hook에 영향 없음)
  if (event.hookEventName === "Stop") {
    try {
      const messages = readTranscriptMessages(event.sessionId, process.cwd());
      if (messages.length > 0) {
        await api.sendMessages(
          apiUrl,
          config.token,
          event.projectId,
          event.sessionId,
          messages,
        );
        debugLog(`transcript sent: ${messages.length} messages`);
      }
    } catch (err) {
      debugLog("failed to send transcript messages", err);
    }
  }
}

async function buildEventPayload(
  payload: ClaudeHookPayload,
  projectId: string,
): Promise<IngestEvent | null> {
  const hookEventName = payload.hook_event_name!;
  const sessionId = payload.session_id!;

  let usage: Usage | undefined;
  let isSlashCommand: boolean | undefined;
  let slashCommandName: string | undefined;

  // SessionStart: slash command 감지
  if (hookEventName === "SessionStart" && payload.transcript_path) {
    const slash = detectSlashCommand(payload.transcript_path);
    if (slash) {
      isSlashCommand = true;
      slashCommandName = slash;
    }
  }

  // Stop / SubagentStop: transcript에서 토큰 합산
  if (hookEventName === "Stop" || hookEventName === "SubagentStop") {
    const transcriptPath =
      payload.agent_transcript_path ?? payload.transcript_path;
    if (transcriptPath) {
      const extracted = extractUsageFromTranscript(transcriptPath);
      if (extracted) {
        usage = {
          inputTokens: extracted.inputTokens,
          outputTokens: extracted.outputTokens,
          cacheCreationTokens: extracted.cacheCreationTokens,
          cacheReadTokens: extracted.cacheReadTokens,
          model: extracted.model,
          isSubagent: hookEventName === "SubagentStop",
        };
      }
    }
  }

  const draft: IngestEvent = {
    projectId,
    sessionId,
    transcriptPath: payload.transcript_path,
    hookEventName: hookEventName as IngestEvent["hookEventName"],
    toolName: payload.tool_name,
    toolInput: payload.tool_input
      ? truncate(safeStringify(payload.tool_input), TRUNCATION_LIMITS.toolPayload)
      : undefined,
    toolResponse: payload.tool_response
      ? truncate(
          safeStringify(payload.tool_response),
          TRUNCATION_LIMITS.toolPayload,
        )
      : undefined,
    exitCode: typeof payload.exit_code === "number" ? payload.exit_code : undefined,
    isSlashCommand,
    slashCommandName,
    agentId: payload.agent_id,
    usage,
    timestamp: new Date().toISOString(),
    rawPayload: payload as Record<string, unknown>,
  };

  // Zod로 자체 검증 (잘못된 값 보내기 전에 차단)
  const parsed = IngestEventSchema.safeParse(draft);
  if (!parsed.success) {
    debugLog("payload validation failed", parsed.error.flatten());
    return null;
  }
  return parsed.data;
}

function safeStringify(value: unknown): string {
  try {
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
