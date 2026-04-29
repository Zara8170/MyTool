import "server-only";
import { TRUNCATION_LIMITS, truncate } from "@mytool/shared";

export interface ParsedEventDerivations {
  isSkillCall: boolean;
  skillName: string | null;
  isAgentCall: boolean;
  agentType: string | null;
  agentDesc: string | null;
}

export function parseEventDerivations(
  toolName: string | null | undefined,
  toolInputJson: string | null | undefined,
): ParsedEventDerivations {
  const result: ParsedEventDerivations = {
    isSkillCall: false,
    skillName: null,
    isAgentCall: false,
    agentType: null,
    agentDesc: null,
  };

  if (!toolName) return result;

  let parsedInput: Record<string, unknown> | null = null;
  if (toolInputJson) {
    try {
      const v = JSON.parse(toolInputJson);
      if (v && typeof v === "object") parsedInput = v as Record<string, unknown>;
    } catch {
      // ignore
    }
  }

  if (toolName === "Skill") {
    result.isSkillCall = true;
    if (parsedInput && typeof parsedInput["skill"] === "string") {
      result.skillName = parsedInput["skill"] as string;
    }
  } else if (toolName === "Agent" || toolName === "Task") {
    result.isAgentCall = true;
    if (parsedInput && typeof parsedInput["subagent_type"] === "string") {
      result.agentType = parsedInput["subagent_type"] as string;
    }
    if (parsedInput && typeof parsedInput["description"] === "string") {
      result.agentDesc = (parsedInput["description"] as string).slice(0, 500);
    }
  }

  return result;
}

export function truncateToolPayload(s: string | null | undefined): string | null {
  if (!s) return null;
  return truncate(s, TRUNCATION_LIMITS.toolPayload);
}
