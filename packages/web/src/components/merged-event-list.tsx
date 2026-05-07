"use client";

import { useState } from "react";

export type EventPairRow = {
  id: string;
  label: string;
  colorKey: "read" | "bash" | "edit" | "skill" | "agent" | "other";
  isTool: boolean;
  durationMs: number | null;
  elapsedSec: number;
  isSkillCall: boolean;
  skillName: string | null;
  isAgentCall: boolean;
  agentType: string | null;
  agentDesc: string | null;
  isSlashCommand: boolean;
  slashCommandName: string | null;
  exitCode: number | null;
  toolInput: string | null;
  toolResponse: string | null;
};

interface Props {
  rows: EventPairRow[];
}

const ROW_HIGHLIGHT: Partial<Record<EventPairRow["colorKey"], string>> = {
  skill: "border-l-2 border-l-amber-500 bg-amber-950/20",
  agent: "border-l-2 border-l-purple-500 bg-purple-950/20",
};

const COLOR_TEXT: Record<EventPairRow["colorKey"], string> = {
  read: "text-blue-300",
  bash: "text-orange-300",
  edit: "text-green-300",
  skill: "text-amber-300",
  agent: "text-purple-300",
  other: "text-gray-400",
};

const DOT_BG: Record<EventPairRow["colorKey"], string> = {
  read: "bg-blue-500",
  bash: "bg-orange-500",
  edit: "bg-green-500",
  skill: "bg-amber-400",
  agent: "bg-purple-500",
  other: "bg-gray-500",
};

type FilterKey = "all" | "slow" | "skill" | "agent" | "bash" | "edit" | "read";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "전체" },
  { key: "slow", label: "느린 작업 (≥10s)" },
  { key: "skill", label: "Skill" },
  { key: "agent", label: "Agent" },
  { key: "bash", label: "Bash" },
  { key: "edit", label: "Edit" },
  { key: "read", label: "Read" },
];

function applyFilter(rows: EventPairRow[], filter: FilterKey): EventPairRow[] {
  if (filter === "all") return rows;
  return rows.filter((row) => {
    if (!row.isTool) return false;
    switch (filter) {
      case "slow": return (row.durationMs ?? 0) >= 10_000;
      case "skill": return row.isSkillCall;
      case "agent": return row.isAgentCall;
      case "bash": return row.colorKey === "bash";
      case "edit": return row.colorKey === "edit";
      case "read": return row.colorKey === "read";
    }
  });
}

function countFilter(rows: EventPairRow[], filter: FilterKey): number {
  return applyFilter(rows, filter).length;
}

export function MergedEventList({ rows }: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterKey>("all");

  const toggle = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const visible = applyFilter(rows, filter);

  return (
    <div>
      {/* 필터 바 */}
      <div className="px-4 py-2.5 border-b flex items-center gap-1.5 flex-wrap">
        {FILTERS.map(({ key, label }) => {
          const count = key === "all" ? rows.length : countFilter(rows, key);
          if (count === 0 && key !== "all") return null;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`text-xs px-2 py-0.5 rounded border transition-colors flex items-center gap-1 ${
                filter === key
                  ? "border-accent text-accent bg-accent/10"
                  : "border-border text-muted hover:text-text hover:border-text/30"
              }`}
            >
              {label}
              <span className={`tabular-nums ${filter === key ? "text-accent/70" : "text-muted/60"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 결과 없음 */}
      {visible.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-muted">
          해당 필터에 맞는 이벤트가 없습니다.
        </div>
      )}

    <div className="divide-y divide-border">
      {visible.map((row) => {
        const expanded = expandedIds.has(row.id);
        const hasDetails = !!(row.toolInput || row.toolResponse);
        const isHighlighted = row.isSkillCall || row.isAgentCall;
        const rowCls = isHighlighted ? (ROW_HIGHLIGHT[row.colorKey] ?? "") : "";

        return (
          <div key={row.id} id={`event-${row.id}`} className={rowCls}>
            <button
              className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                hasDetails ? "hover:bg-white/5 cursor-pointer" : "cursor-default"
              }`}
              onClick={() => hasDetails && toggle(row.id)}
              disabled={!hasDetails}
            >
              {/* elapsed */}
              <span className="text-xs text-muted tabular-nums w-14 shrink-0">
                +{row.elapsedSec}s
              </span>

              {/* color dot */}
              {row.isTool ? (
                <div className={`w-2 h-2 rounded-full shrink-0 ${DOT_BG[row.colorKey]}`} />
              ) : (
                <div className="w-2 h-2 shrink-0" />
              )}

              {/* label */}
              <span
                className={`font-mono text-sm flex-1 min-w-0 truncate ${
                  isHighlighted ? COLOR_TEXT[row.colorKey] : "text-text"
                }`}
              >
                {row.label}
              </span>

              {/* badges */}
              <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                {row.isSkillCall && row.skillName && (
                  <Badge color="amber">skill:{row.skillName}</Badge>
                )}
                {row.isAgentCall && row.agentType && (
                  <Badge color="purple">agent:{row.agentType}</Badge>
                )}
                {row.isSlashCommand && row.slashCommandName && (
                  <Badge color="blue">/{row.slashCommandName}</Badge>
                )}
                {row.exitCode !== null && row.exitCode !== 0 && (
                  <Badge color="red">exit:{row.exitCode}</Badge>
                )}
                {row.isTool && row.durationMs !== null && (
                  <DurationBadge ms={row.durationMs} />
                )}
              </div>

              {hasDetails && (
                <span className="text-muted text-xs shrink-0 ml-1">
                  {expanded ? "▲" : "▼"}
                </span>
              )}
            </button>

            {expanded && hasDetails && (
              <div className="px-4 pb-3 space-y-2 ml-[4.25rem]">
                {row.toolInput && <PreBlock label="Input" content={row.toolInput} />}
                {row.toolResponse && (
                  <PreBlock label="Response" content={row.toolResponse} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
    </div>
  );
}

function DurationBadge({ ms }: { ms: number }) {
  const cls =
    ms < 2_000
      ? "text-green-400 border-green-900/60 bg-green-950/30"
      : ms < 10_000
        ? "text-yellow-400 border-yellow-900/60 bg-yellow-950/30"
        : ms < 30_000
          ? "text-orange-400 border-orange-900/60 bg-orange-950/30"
          : "text-red-400 border-red-900/60 bg-red-950/30";

  return (
    <span className={`text-xs px-1.5 py-0.5 rounded border tabular-nums ${cls}`}>
      {formatMs(ms)}
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

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
