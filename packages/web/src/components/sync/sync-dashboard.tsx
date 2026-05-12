"use client";

// PR 3 — /settings/sync 의 4열 UI + Job 패널.
//
// 흐름:
//   1열 Source Device → 2열 Source Project (또는 Global) → 3열 Items → 4열 Target + 옵션
//   "복사 실행" 누르면 POST /api/sync/jobs → 초기 jobs 목록에 prepend.
//   Job 패널은 5초마다 GET /api/sync/jobs 로 갱신.

import { useEffect, useMemo, useState } from "react";
import type {
  Device,
  SnapshotDetail,
  SnapshotSummary,
  SyncJobOptions,
  SyncJobSummary,
  SyncManifestItem,
} from "@mytool/shared";

interface ProjectInfo {
  id: string;
  orgId: string;
  orgName: string;
  name: string;
  slug: string;
}

interface Props {
  devices: Device[];
  snapshots: SnapshotSummary[];
  projects: ProjectInfo[];
  initialJobs: SyncJobSummary[];
  /** skillName → 최근 30일 호출 수 */
  skillUsage: Record<string, number>;
}

export function SyncDashboard(props: Props) {
  const { devices, snapshots, projects, initialJobs, skillUsage } = props;

  // ── 1열: 소스 device ────────────────────────────────────────────
  // device 별 가장 최근 snapshot 매핑
  const latestByDevice = useMemo(() => {
    const m = new Map<string, SnapshotSummary>();
    for (const s of snapshots) {
      const cur = m.get(s.deviceId);
      if (!cur || new Date(s.createdAt) > new Date(cur.createdAt)) m.set(s.deviceId, s);
    }
    return m;
  }, [snapshots]);

  const [sourceDeviceId, setSourceDeviceId] = useState<string | null>(
    devices.find((d) => latestByDevice.has(d.id))?.id ?? devices[0]?.id ?? null,
  );
  const sourceSnapshot = sourceDeviceId ? latestByDevice.get(sourceDeviceId) : undefined;

  // ── 소스 snapshot 의 manifest 를 lazy fetch ──────────────────────
  const [snapshotDetail, setSnapshotDetail] = useState<SnapshotDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!sourceSnapshot) {
      setSnapshotDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    fetch(`/api/sync/snapshots/${sourceSnapshot.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: SnapshotDetail) => {
        if (!cancelled) setSnapshotDetail(d);
      })
      .catch(() => {
        if (!cancelled) setSnapshotDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceSnapshot?.id]);

  // ── 2열: 소스 project (또는 global) ────────────────────────────
  // manifest items 에서 unique projects 뽑기
  const sourceProjects = useMemo(() => {
    if (!snapshotDetail) return [];
    const set = new Set<string>();
    for (const it of snapshotDetail.manifest.items) {
      if (it.scope === "project" && it.project) set.add(it.project);
    }
    return Array.from(set).sort();
  }, [snapshotDetail]);

  type SourceScope = { kind: "global" } | { kind: "project"; project: string };
  const [sourceScope, setSourceScope] = useState<SourceScope>({ kind: "global" });

  // 소스 변경 시 scope 리셋
  useEffect(() => {
    setSourceScope({ kind: "global" });
    setSelectedItemIds(new Set());
  }, [snapshotDetail?.id]);

  // ── 3열: items 후보 ────────────────────────────────────────────
  const itemCandidates = useMemo<SyncManifestItem[]>(() => {
    if (!snapshotDetail) return [];
    if (sourceScope.kind === "global") {
      return snapshotDetail.manifest.items.filter((it) => it.scope === "global");
    }
    return snapshotDetail.manifest.items.filter(
      (it) => it.scope === "project" && it.project === sourceScope.project,
    );
  }, [snapshotDetail, sourceScope]);

  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  function toggleItem(id: string) {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() {
    setSelectedItemIds(new Set(itemCandidates.map((it) => it.id)));
  }
  function selectNone() {
    setSelectedItemIds(new Set());
  }

  // ── 4열: target ────────────────────────────────────────────────
  const [targetDeviceIds, setTargetDeviceIds] = useState<Set<string>>(new Set());
  const [targetProjectIds, setTargetProjectIds] = useState<Set<string>>(new Set());
  const [optMask, setOptMask] = useState(true);
  const [optOverwrite, setOptOverwrite] = useState<SyncJobOptions["overwrite"]>("backup");

  function toggleTargetDevice(id: string) {
    setTargetDeviceIds((prev) => toggleSet(prev, id));
  }
  function toggleTargetProject(id: string) {
    setTargetProjectIds((prev) => toggleSet(prev, id));
  }

  // ── Job 패널 (5초 폴링) ─────────────────────────────────────────
  const [jobs, setJobs] = useState<SyncJobSummary[]>(initialJobs);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/sync/jobs");
        if (!res.ok) return;
        const data = (await res.json()) as SyncJobSummary[];
        if (!cancelled) setJobs(data);
      } catch {
        /* ignore */
      }
    };
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // ── "복사 실행" ─────────────────────────────────────────────────
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const itemsHaveProjectScope = itemCandidates
    .filter((it) => selectedItemIds.has(it.id))
    .some((it) => it.scope === "project");
  const needsTargetProject = itemsHaveProjectScope;
  const canExecute =
    sourceSnapshot &&
    sourceSnapshot.hasBundle &&
    selectedItemIds.size > 0 &&
    targetDeviceIds.size > 0 &&
    (!needsTargetProject || targetProjectIds.size > 0);

  async function execute() {
    if (!sourceSnapshot || !canExecute) return;
    setExecuting(true);
    setError(null);
    try {
      const itemIds = Array.from(selectedItemIds);
      const targetProjectArr =
        needsTargetProject && targetProjectIds.size > 0
          ? Array.from(targetProjectIds)
          : [null];
      const created: SyncJobSummary[] = [];
      for (const td of targetDeviceIds) {
        for (const tp of targetProjectArr) {
          const res = await fetch("/api/sync/jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sourceSnapshotId: sourceSnapshot.id,
              targetDeviceId: td,
              ...(tp ? { targetProjectId: tp } : {}),
              itemIds,
              options: { mask: optMask, overwrite: optOverwrite },
            }),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as {
              error?: { message?: string };
            };
            throw new Error(body.error?.message ?? `HTTP ${res.status}`);
          }
          created.push((await res.json()) as SyncJobSummary);
        }
      }
      setJobs((prev) => [...created, ...prev]);
      setSelectedItemIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuting(false);
    }
  }

  // ── 빈 상태 ─────────────────────────────────────────────────────
  if (devices.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* 1열 — Source Device */}
        <div className="bg-panel border rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-3">Source Device</h2>
          <ul className="space-y-1">
            {devices.map((d) => {
              const last = latestByDevice.get(d.id);
              const selected = sourceDeviceId === d.id;
              return (
                <li key={d.id}>
                  <label className="flex items-start gap-2 py-1 cursor-pointer">
                    <input
                      type="radio"
                      name="source-device"
                      checked={selected}
                      onChange={() => setSourceDeviceId(d.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{d.name}</div>
                      <div className="text-xs text-muted">
                        {last
                          ? `${last.itemCount} items · ${ago(last.createdAt)}`
                          : "no snapshot"}
                        {last?.masked && " · masked"}
                      </div>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
          {sourceSnapshot && !sourceSnapshot.hasBundle && (
            <p className="text-xs text-yellow-400 mt-3">
              Bundle not yet uploaded for this snapshot.
            </p>
          )}
          <p className="text-xs text-muted mt-3">
            Tip: <code className="bg-bg px-1 rounded">mytool sync push</code> on
            this PC to refresh.
          </p>
        </div>

        {/* 2열 — Source Scope */}
        <div className="bg-panel border rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-3">Source Scope</h2>
          {detailLoading ? (
            <p className="text-xs text-muted">Loading manifest...</p>
          ) : !snapshotDetail ? (
            <p className="text-xs text-muted">Pick a source device first.</p>
          ) : (
            <ul className="space-y-1">
              <li>
                <label className="flex items-center gap-2 py-1 cursor-pointer">
                  <input
                    type="radio"
                    name="source-scope"
                    checked={sourceScope.kind === "global"}
                    onChange={() => setSourceScope({ kind: "global" })}
                  />
                  <span className="text-sm">Global (~/.claude)</span>
                </label>
              </li>
              {sourceProjects.map((p) => (
                <li key={p}>
                  <label className="flex items-center gap-2 py-1 cursor-pointer">
                    <input
                      type="radio"
                      name="source-scope"
                      checked={
                        sourceScope.kind === "project" && sourceScope.project === p
                      }
                      onChange={() => setSourceScope({ kind: "project", project: p })}
                    />
                    <span className="text-sm truncate">{p}</span>
                  </label>
                </li>
              ))}
              {sourceProjects.length === 0 && (
                <li className="text-xs text-muted">No projects in this snapshot.</li>
              )}
            </ul>
          )}
        </div>

        {/* 3열 — Items */}
        <div className="bg-panel border rounded-lg p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-sm font-semibold">
              Items ({selectedItemIds.size}/{itemCandidates.length})
            </h2>
            <div className="space-x-2 text-xs">
              <button onClick={selectAll} className="text-muted hover:text-text">
                all
              </button>
              <button onClick={selectNone} className="text-muted hover:text-text">
                none
              </button>
            </div>
          </div>
          <ul className="space-y-1 max-h-96 overflow-auto">
            {itemCandidates.map((it) => {
              const skillCalls =
                it.type === "global:skill" || it.type === "project:skill"
                  ? skillUsage[it.name]
                  : undefined;
              return (
                <li key={it.id}>
                  <label className="flex items-start gap-2 py-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedItemIds.has(it.id)}
                      onChange={() => toggleItem(it.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">
                        <span className="text-muted">[{it.type}]</span> {it.name}
                      </div>
                      {skillCalls != null && skillCalls > 0 && (
                        <div className="text-xs text-accent">
                          {skillCalls} call{skillCalls !== 1 ? "s" : ""} (30d)
                        </div>
                      )}
                    </div>
                  </label>
                </li>
              );
            })}
            {itemCandidates.length === 0 && (
              <li className="text-xs text-muted">No items in this scope.</li>
            )}
          </ul>
        </div>

        {/* 4열 — Target + Options */}
        <div className="bg-panel border rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-3">Target</h2>
          <div className="space-y-3">
            <div>
              <div className="text-xs text-muted mb-1">Devices</div>
              <ul className="space-y-1">
                {devices.map((d) => (
                  <li key={d.id}>
                    <label className="flex items-center gap-2 py-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={targetDeviceIds.has(d.id)}
                        onChange={() => toggleTargetDevice(d.id)}
                      />
                      <span className="text-sm truncate">{d.name}</span>
                      {d.id === sourceDeviceId && (
                        <span className="text-xs text-muted">(self)</span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            {needsTargetProject && (
              <div>
                <div className="text-xs text-muted mb-1">
                  Projects (required for project-scope items)
                </div>
                <ul className="space-y-1 max-h-32 overflow-auto">
                  {projects.map((p) => (
                    <li key={p.id}>
                      <label className="flex items-center gap-2 py-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={targetProjectIds.has(p.id)}
                          onChange={() => toggleTargetProject(p.id)}
                        />
                        <span className="text-sm truncate">{p.name}</span>
                      </label>
                    </li>
                  ))}
                  {projects.length === 0 && (
                    <li className="text-xs text-muted">No projects yet.</li>
                  )}
                </ul>
              </div>
            )}

            <div>
              <div className="text-xs text-muted mb-1">Options</div>
              <label className="flex items-center gap-2 py-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={optMask}
                  onChange={(e) => setOptMask(e.target.checked)}
                />
                <span className="text-sm">Mask secrets</span>
              </label>
              <fieldset className="mt-1 space-y-1">
                {(["backup", "force", "skip"] as const).map((mode) => (
                  <label
                    key={mode}
                    className="flex items-center gap-2 py-0.5 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="overwrite"
                      checked={optOverwrite === mode}
                      onChange={() => setOptOverwrite(mode)}
                    />
                    <span className="text-sm">
                      {mode === "backup" && "Backup then overwrite"}
                      {mode === "force" && "Force overwrite"}
                      {mode === "skip" && "Skip if exists"}
                    </span>
                  </label>
                ))}
              </fieldset>
            </div>

            <button
              onClick={execute}
              disabled={!canExecute || executing}
              className="w-full bg-accent text-bg rounded py-2 text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              {executing ? "Creating jobs..." : "Copy"}
            </button>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        </div>
      </div>

      {/* Jobs 패널 */}
      <section className="bg-panel border rounded-lg p-4">
        <h2 className="text-sm font-semibold mb-3">
          Recent Sync Jobs <span className="text-muted text-xs">(updates every 5s)</span>
        </h2>
        {jobs.length === 0 ? (
          <p className="text-xs text-muted">No jobs yet.</p>
        ) : (
          <ul className="space-y-2">
            {jobs.slice(0, 10).map((j) => (
              <JobRow
                key={j.id}
                job={j}
                devices={devices}
                projects={projects}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function JobRow({
  job,
  devices,
  projects,
}: {
  job: SyncJobSummary;
  devices: Device[];
  projects: ProjectInfo[];
}) {
  const target = devices.find((d) => d.id === job.targetDeviceId);
  const proj = job.targetProjectId
    ? projects.find((p) => p.id === job.targetProjectId)
    : null;
  const icon = (() => {
    switch (job.status) {
      case "done":
        return "✓";
      case "failed":
        return "✗";
      case "partial":
        return "△";
      case "running":
        return "⟳";
      default:
        return "·";
    }
  })();
  const color = (() => {
    switch (job.status) {
      case "done":
        return "text-green-400";
      case "failed":
        return "text-red-400";
      case "partial":
        return "text-yellow-400";
      default:
        return "text-muted";
    }
  })();
  return (
    <li className="text-sm">
      <span className={`${color} font-mono mr-2`}>{icon}</span>
      <span className="font-medium">
        → {target?.name ?? job.targetDeviceId}
        {proj ? ` · ${proj.name}` : ""}
      </span>
      <span className="text-xs text-muted ml-2">
        · {job.itemIds.length} item{job.itemIds.length !== 1 ? "s" : ""} ·{" "}
        {ago(job.createdAt)} · {job.status}
      </span>
      {job.result && job.result.errors.length > 0 && (
        <div className="text-xs text-red-400 ml-6">
          {job.result.errors.length} error(s):{" "}
          {job.result.errors[0]?.message}
          {job.result.errors.length > 1 ? " ..." : ""}
        </div>
      )}
      {job.status === "pending" && target && (
        <div className="text-xs text-muted ml-6">
          Waiting for{" "}
          <code className="bg-bg px-1 rounded">mytool sync pull</code> on{" "}
          {target.name}.
        </div>
      )}
    </li>
  );
}

function EmptyState() {
  return (
    <div className="bg-panel border rounded-lg p-8 text-center space-y-3">
      <h2 className="text-lg font-semibold">No devices yet</h2>
      <p className="text-sm text-muted">
        Sync needs at least one registered device. Run the CLI on the PC you
        want to sync from:
      </p>
      <pre className="bg-bg border rounded p-3 text-xs overflow-auto inline-block text-left">
        mytool sync push
      </pre>
      <p className="text-xs text-muted">
        It will register this PC as a device and upload a snapshot of your
        Claude Code skills, agents, and settings.
      </p>
    </div>
  );
}

function toggleSet<T>(prev: Set<T>, value: T): Set<T> {
  const next = new Set(prev);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
