"use client";

import { useState } from "react";

export type GanttSegment = {
  id: string;
  label: string;
  toolName: string | null;
  startPct: number;
  widthPct: number;
  durationMs: number;
  estimatedTokens: number;
  tokenPct: number;
  colorKey: "read" | "bash" | "edit" | "skill" | "agent" | "other";
};

const COLOR_BG: Record<GanttSegment["colorKey"], string> = {
  read: "bg-blue-500",
  bash: "bg-orange-500",
  edit: "bg-green-500",
  skill: "bg-amber-400",
  agent: "bg-purple-500",
  other: "bg-gray-500",
};

const COLOR_TEXT: Record<GanttSegment["colorKey"], string> = {
  read: "text-blue-300",
  bash: "text-orange-300",
  edit: "text-green-300",
  skill: "text-amber-300",
  agent: "text-purple-300",
  other: "text-gray-400",
};

interface Props {
  segments: GanttSegment[];
  durationMs: number;
}

type SortKey = "tokens" | "time";

export function SessionGantt({ segments }: Props) {
  const [sort, setSort] = useState<SortKey>("tokens");
  const [activeId, setActiveId] = useState<string | null>(null);

  // 로그 스케일: 한 작업이 극단적으로 길어도 나머지가 압사되지 않게
  const maxDuration = Math.max(...segments.map((s) => s.durationMs), 1);
  const logScale = (ms: number) =>
    Math.log10(ms + 1) / Math.log10(maxDuration + 1);

  const sorted =
    sort === "tokens"
      ? [...segments].sort((a, b) => b.durationMs - a.durationMs)
      : [...segments].sort((a, b) => a.startPct - b.startPct);

  const active = segments.find((s) => s.id === activeId);

  return (
    <div className="space-y-4">
      {/* 정렬 토글 */}
      <div className="flex items-center gap-1 text-xs">
        <span className="text-muted mr-2">정렬:</span>
        {(
          [
            ["tokens", "소요시간 순"],
            ["time", "실행 순서 순"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSort(key)}
            className={`px-2 py-0.5 rounded border transition-colors ${
              sort === key
                ? "border-accent text-accent"
                : "border-border text-muted hover:text-text"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 바 차트 */}
      <div
        className="space-y-1.5"
        onMouseLeave={() => setActiveId(null)}
      >
        {sorted.map((seg) => {
          const barWidth = logScale(seg.durationMs) * 100;
          const isActive = activeId === seg.id;
          return (
            <div
              key={seg.id}
              className="flex items-center gap-3 group"
              onMouseEnter={() => setActiveId(seg.id)}
            >
              {/* 라벨 */}
              <div
                className={`w-36 shrink-0 text-xs font-mono truncate text-right transition-colors ${
                  isActive ? COLOR_TEXT[seg.colorKey] : "text-muted group-hover:text-text"
                }`}
                title={seg.label}
              >
                {seg.label}
              </div>

              {/* 바 */}
              <div className="flex-1 h-5 bg-bg rounded overflow-hidden">
                <div
                  className={`h-full rounded transition-all duration-150 ${COLOR_BG[seg.colorKey]} ${
                    isActive ? "opacity-100" : "opacity-60 group-hover:opacity-80"
                  }`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>

              {/* 수치 */}
              <div className="w-40 shrink-0 text-xs tabular-nums flex justify-between">
                <span className={isActive ? "text-text" : "text-muted"}>
                  ~{formatTokens(seg.estimatedTokens)}
                </span>
                <span className="text-muted">{formatMs(seg.durationMs)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 호버 상세 툴팁 */}
      <div className="h-8 flex items-center">
        {active ? (
          <div className="text-xs flex items-center gap-4 px-1">
            <span className={`font-medium ${COLOR_TEXT[active.colorKey]}`}>
              {active.label}
            </span>
            <span className="text-muted">
              소요시간 <span className="text-text">{formatMs(active.durationMs)}</span>
            </span>
            <span className="text-muted">
              추정 토큰{" "}
              <span className="text-text">
                ~{active.estimatedTokens.toLocaleString()}
              </span>
            </span>
            <span className="text-muted">
              세션 비율{" "}
              <span className="text-text">{active.tokenPct.toFixed(1)}%</span>
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted px-1">
            각 항목에 마우스를 올리면 세부 정보를 볼 수 있어요
          </p>
        )}
      </div>

      {/* 범례 */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {(
          [
            ["read", "Read / Glob / Grep"],
            ["bash", "Bash"],
            ["edit", "Edit / Write"],
            ["skill", "Skill 호출"],
            ["agent", "Agent 호출"],
            ["other", "기타"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${COLOR_BG[key]}`} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
