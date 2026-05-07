"use client";

import { useState, useTransition } from "react";

interface ToggleCardProps {
  projectId: string;
  axis: "sync" | "harness";
  initialEnabled: boolean;
}

const AXIS_META = {
  sync: {
    title: "Sync (Skills 축)",
    description: "프로젝트 간 스킬·설정 이전, 전역/로컬 자산 관리",
    field: "syncEnabled" as const,
    activeHint: "Settings → Sync 페이지에서 다른 프로젝트로 복사 가능",
    inactiveHint: "활성화하면 이 프로젝트의 스킬을 다른 프로젝트로 이전할 수 있습니다",
  },
  harness: {
    title: "Harness (Execution 축)",
    description: "harness.yaml 자동 사이클 + PreToolUse 강제 규칙",
    field: "harnessEnabled" as const,
    activeHint: "verify·commit 자동화 + 도구 호출 강제 규칙 적용",
    inactiveHint: "활성화하면 harness 자동 사이클과 안전 규칙이 적용됩니다",
  },
};

export function WorkspaceToggleCard({ projectId, axis, initialEnabled }: ToggleCardProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const meta = AXIS_META[axis];

  const onToggle = () => {
    const next = !enabled;
    // optimistic update
    setEnabled(next);
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [meta.field]: next }),
        });
        if (!res.ok) {
          const body = await safeJson(res);
          throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
        }
      } catch (e) {
        // rollback
        setEnabled(!next);
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="bg-panel border rounded-lg p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{meta.title}</div>
          <div className="text-xs text-muted mt-0.5">{meta.description}</div>
        </div>
        <Switch enabled={enabled} pending={pending} onClick={onToggle} />
      </div>
      <div className="text-xs text-muted">
        {enabled ? meta.activeHint : meta.inactiveHint}
      </div>
      {error && (
        <div className="text-xs text-red-500 mt-1">⚠️ {error}</div>
      )}
    </div>
  );
}

function Switch({
  enabled,
  pending,
  onClick,
}: {
  enabled: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-busy={pending}
      disabled={pending}
      onClick={onClick}
      className={
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors " +
        "disabled:opacity-60 " +
        (enabled ? "bg-emerald-500" : "bg-zinc-600")
      }
    >
      <span
        className={
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform " +
          (enabled ? "translate-x-5" : "translate-x-0.5")
        }
      />
      <span className="sr-only">{enabled ? "활성화됨" : "비활성"}</span>
    </button>
  );
}

async function safeJson(res: Response): Promise<{ error?: { message?: string } } | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
