"use client";

import { useState } from "react";

export type RibbonSegment = {
  id: string;
  label: string;
  colorKey: "read" | "bash" | "edit" | "skill" | "agent" | "other";
  durationMs: number;
  isOutlier: boolean;
};

const SEG_BG: Record<RibbonSegment["colorKey"], string> = {
  read: "bg-blue-500",
  bash: "bg-orange-500",
  edit: "bg-green-500",
  skill: "bg-amber-400",
  agent: "bg-purple-500",
  other: "bg-gray-500",
};

const SEG_TEXT: Record<RibbonSegment["colorKey"], string> = {
  read: "text-blue-300",
  bash: "text-orange-300",
  edit: "text-green-300",
  skill: "text-amber-300",
  agent: "text-purple-300",
  other: "text-gray-400",
};

interface Props {
  segments: RibbonSegment[];
}

export function ActivityRibbon({ segments }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hovered = segments.find((s) => s.id === hoveredId);

  if (segments.length === 0) return null;

  const handleClick = (id: string) => {
    document
      .getElementById(`event-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <div className="space-y-2">
      {/* Ribbon strip — each segment = equal width, 1 tool call */}
      <div className="flex h-7 gap-px rounded overflow-hidden bg-bg">
        {segments.map((seg) => (
          <div
            key={seg.id}
            className={`relative flex-1 min-w-0 cursor-pointer transition-opacity ${SEG_BG[seg.colorKey]} ${
              hoveredId && hoveredId !== seg.id ? "opacity-25" : "opacity-75 hover:opacity-100"
            }`}
            onMouseEnter={() => setHoveredId(seg.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={() => handleClick(seg.id)}
          >
            {seg.isOutlier && (
              <div className="absolute top-1 right-0.5 w-1.5 h-1.5 rounded-full bg-red-400 ring-1 ring-black/40" />
            )}
          </div>
        ))}
      </div>

      {/* Hover tooltip row */}
      <div className="h-5 flex items-center">
        {hovered ? (
          <span className="text-xs flex items-center gap-3 px-1">
            <span className={`font-mono font-medium ${SEG_TEXT[hovered.colorKey]}`}>
              {hovered.label}
            </span>
            <span className="text-muted">{formatMs(hovered.durationMs)}</span>
            {hovered.isOutlier && <span className="text-red-400">⚠ 이상치</span>}
          </span>
        ) : (
          <span className="text-xs text-muted px-1">
            각 칸 = 툴 호출 1회 (동일 너비) · 클릭하면 이벤트로 이동
          </span>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {(
          [
            ["read", "Read / Glob / Grep"],
            ["bash", "Bash"],
            ["edit", "Edit / Write"],
            ["skill", "Skill"],
            ["agent", "Agent"],
            ["other", "기타"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${SEG_BG[key]}`} />
            <span>{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-red-400" />
          <span>이상치 (중앙값 × 10)</span>
        </div>
      </div>
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
