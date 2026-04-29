"use client";

import { useState } from "react";
import type { EventItem } from "@mytool/shared";

interface Props {
  event: EventItem;
  sessionStart: string;
}

export function EventItemRow({ event, sessionStart }: Props) {
  const [expanded, setExpanded] = useState(false);

  const hasDetails = event.toolInput || event.toolResponse;
  const elapsed = Math.round(
    (new Date(event.timestamp).getTime() -
      new Date(sessionStart).getTime()) /
      1000,
  );

  return (
    <div className="border-b last:border-b-0">
      <button
        className={`w-full text-left px-4 py-3 flex items-start gap-3 ${hasDetails ? "hover:bg-bg/50 cursor-pointer" : "cursor-default"} transition-colors`}
        onClick={() => hasDetails && setExpanded((v) => !v)}
        disabled={!hasDetails}
      >
        {/* 타임스탬프 */}
        <span className="text-xs text-muted tabular-nums w-14 shrink-0 mt-0.5">
          +{elapsed}s
        </span>

        {/* 훅 타입 배지 */}
        <HookBadge name={event.hookEventName} />

        {/* 툴 이름 + 특수 배지 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {event.toolName && (
              <span className="font-mono text-sm">{event.toolName}</span>
            )}
            {event.isSkillCall && event.skillName && (
              <Badge color="amber">skill:{event.skillName}</Badge>
            )}
            {event.isAgentCall && event.agentType && (
              <Badge color="purple">agent:{event.agentType}</Badge>
            )}
            {event.isSlashCommand && event.slashCommandName && (
              <Badge color="blue">/{event.slashCommandName}</Badge>
            )}
            {event.agentDesc && (
              <span className="text-xs text-muted truncate max-w-xs">
                {event.agentDesc}
              </span>
            )}
            {event.exitCode !== null && event.exitCode !== 0 && (
              <Badge color="red">exit:{event.exitCode}</Badge>
            )}
          </div>
        </div>

        {hasDetails && (
          <span className="text-muted text-xs shrink-0 mt-0.5">
            {expanded ? "▲" : "▼"}
          </span>
        )}
      </button>

      {expanded && hasDetails && (
        <div className="px-4 pb-3 space-y-2 ml-[4.25rem]">
          {event.toolInput && (
            <PreBlock label="Input" content={event.toolInput} />
          )}
          {event.toolResponse && (
            <PreBlock label="Response" content={event.toolResponse} />
          )}
        </div>
      )}
    </div>
  );
}

function HookBadge({ name }: { name: string }) {
  const colorMap: Record<string, string> = {
    PreToolUse: "text-blue-300 bg-blue-950/40 border-blue-900",
    PostToolUse: "text-green-300 bg-green-950/40 border-green-900",
    Stop: "text-muted bg-panel border-border",
    Notification: "text-yellow-300 bg-yellow-950/40 border-yellow-900",
  };
  const cls =
    colorMap[name] ?? "text-muted bg-panel border-border";
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded border shrink-0 ${cls}`}
    >
      {name}
    </span>
  );
}

function Badge({
  color,
  children,
}: {
  color: "amber" | "purple" | "blue" | "red";
  children: React.ReactNode;
}) {
  const map = {
    amber: "text-amber-300 bg-amber-950/40 border-amber-900",
    purple: "text-purple-300 bg-purple-950/40 border-purple-900",
    blue: "text-blue-300 bg-blue-950/40 border-blue-900",
    red: "text-red-300 bg-red-950/40 border-red-900",
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded border ${map[color]}`}>
      {children}
    </span>
  );
}

function PreBlock({ label, content }: { label: string; content: string }) {
  return (
    <div>
      <div className="text-xs text-muted mb-1">{label}</div>
      <pre className="bg-bg border rounded p-2 text-xs overflow-auto max-h-48 whitespace-pre-wrap break-all">
        {content}
      </pre>
    </div>
  );
}
