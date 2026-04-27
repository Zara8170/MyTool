import Link from "next/link";
import { serverFetch } from "@/lib/server-api";
import type { SessionDetail, EventList, EventItem } from "@mytool/shared";
import { ActivityRibbon, type RibbonSegment } from "@/components/activity-ribbon";
import { MergedEventList, type EventPairRow } from "@/components/merged-event-list";

interface PageProps {
  params: Promise<{ projectId: string; sessionId: string }>;
}

// ─────────────────────────────────────────────────────────
// 색상 / 레이블 헬퍼
// ─────────────────────────────────────────────────────────

type ColorKey = RibbonSegment["colorKey"];

function colorKey(event: EventItem): ColorKey {
  if (event.isAgentCall) return "agent";
  if (event.isSkillCall) return "skill";
  const t = event.toolName?.toLowerCase() ?? "";
  if (t === "bash") return "bash";
  if (t === "read" || t === "glob" || t === "grep") return "read";
  if (t === "edit" || t === "write" || t === "notebookedit") return "edit";
  return "other";
}

function toolLabel(event: EventItem): string {
  if (event.isAgentCall && event.agentType) return `agent:${event.agentType}`;
  if (event.isSkillCall && event.skillName) return `skill:${event.skillName}`;
  if (event.isSlashCommand && event.slashCommandName)
    return `/${event.slashCommandName}`;
  if (event.toolName) return event.toolName;
  return event.hookEventName;
}

// ─────────────────────────────────────────────────────────
// 데이터 변환
// ─────────────────────────────────────────────────────────

type PairedResult = {
  preId: string;
  pre: EventItem;
  durationMs: number;
  hasMatch: boolean;
  postResponse: string | null;
};

const OUTLIER_EXCLUDED_TOOLS = new Set(["Agent"]);

function pairEvents(events: EventItem[]): PairedResult[] {
  const postBuckets = new Map<string, EventItem[]>();
  for (const e of events.filter((e) => e.hookEventName === "PostToolUse")) {
    const key = e.toolName ?? "__none__";
    if (!postBuckets.has(key)) postBuckets.set(key, []);
    postBuckets.get(key)!.push(e);
  }
  const usedPostIds = new Set<string>();
  const results: PairedResult[] = [];

  for (const pre of events.filter((e) => e.hookEventName === "PreToolUse")) {
    const excluded = OUTLIER_EXCLUDED_TOOLS.has(pre.toolName ?? "");
    const bucket = postBuckets.get(pre.toolName ?? "__none__") ?? [];
    const match = bucket.find(
      (p) =>
        !usedPostIds.has(p.id) &&
        new Date(p.timestamp) >= new Date(pre.timestamp),
    );
    const durationMs = match
      ? new Date(match.timestamp).getTime() - new Date(pre.timestamp).getTime()
      : 0;
    if (match) usedPostIds.add(match.id);
    results.push({
      preId: pre.id,
      pre,
      durationMs,
      hasMatch: match !== undefined && !excluded,
      postResponse: match?.toolResponse ?? null,
    });
  }
  return results;
}

const MIN_SAMPLES_FOR_OUTLIER = 3;

function perToolMedianThresholds(pairs: PairedResult[]): Map<string, number> {
  const groups = new Map<string, number[]>();
  for (const p of pairs) {
    if (!p.hasMatch) continue;
    const key = p.pre.toolName ?? "__none__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p.durationMs);
  }
  const thresholds = new Map<string, number>();
  for (const [key, durations] of groups) {
    if (durations.length < MIN_SAMPLES_FOR_OUTLIER) continue;
    const sorted = [...durations].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    thresholds.set(key, median * 10);
  }
  return thresholds;
}

function buildRibbonSegments(pairs: PairedResult[]): RibbonSegment[] {
  const thresholds = perToolMedianThresholds(pairs);
  return pairs.map((p) => {
    const key = p.pre.toolName ?? "__none__";
    const threshold = thresholds.get(key);
    return {
      id: p.preId,
      label: toolLabel(p.pre),
      colorKey: colorKey(p.pre),
      durationMs: p.durationMs,
      isOutlier: p.hasMatch && threshold !== undefined && p.durationMs > threshold,
    };
  });
}

function buildEventPairRows(
  events: EventItem[],
  pairs: PairedResult[],
  sessionStart: number,
): EventPairRow[] {
  const pairMap = new Map(pairs.map((p) => [p.preId, p]));

  const thresholds = perToolMedianThresholds(pairs);

  const rows: EventPairRow[] = [];

  for (const event of events) {
    if (event.hookEventName === "PostToolUse") continue;

    const isPre = event.hookEventName === "PreToolUse";
    const pair = isPre ? pairMap.get(event.id) : undefined;

    rows.push({
      id: event.id,
      label: toolLabel(event),
      colorKey: colorKey(event),
      isTool: isPre,
      durationMs: pair?.durationMs ?? null,
      isOutlier: (() => {
        if (!isPre || !pair?.hasMatch) return false;
        const key = event.toolName ?? "__none__";
        const threshold = thresholds.get(key);
        return threshold !== undefined && pair.durationMs > threshold;
      })(),
      elapsedSec: Math.round(
        (new Date(event.timestamp).getTime() - sessionStart) / 1000,
      ),
      isSkillCall: event.isSkillCall,
      skillName: event.skillName,
      isAgentCall: event.isAgentCall,
      agentType: event.agentType,
      agentDesc: event.agentDesc,
      isSlashCommand: event.isSlashCommand,
      slashCommandName: event.slashCommandName,
      exitCode: event.exitCode,
      toolInput: event.toolInput,
      toolResponse: isPre ? (pair?.postResponse ?? null) : event.toolResponse,
    });
  }
  return rows;
}

// ─────────────────────────────────────────────────────────
// 페이지
// ─────────────────────────────────────────────────────────

export default async function SessionDetailPage({ params }: PageProps) {
  const { projectId, sessionId } = await params;

  const [session, eventData] = await Promise.all([
    serverFetch<SessionDetail>(
      `/api/projects/${projectId}/sessions/${sessionId}`,
    ),
    serverFetch<EventList>(
      `/api/projects/${projectId}/sessions/${sessionId}/events?limit=500`,
    ),
  ]);

  const sessionStart = new Date(session.startedAt).getTime();
  const sessionDurationMs = session.endedAt
    ? new Date(session.endedAt).getTime() - sessionStart
    : 0;

  const totalTokens =
    session.inputTokens +
    session.outputTokens +
    session.cacheReadInputTokens +
    session.cacheCreationInputTokens;

  const pairs = pairEvents(eventData.events);
  const ribbonSegments = buildRibbonSegments(pairs);
  const eventPairRows = buildEventPairRows(
    eventData.events,
    pairs,
    sessionStart,
  );

  // 툴 타입별 요약 (작업 분석 섹션용)
  const toolSummary = pairs.reduce(
    (acc, p) => {
      const k = colorKey(p.pre);
      if (!acc[k]) acc[k] = { count: 0, totalMs: 0 };
      acc[k].count++;
      acc[k].totalMs += p.durationMs;
      return acc;
    },
    {} as Record<string, { count: number; totalMs: number }>,
  );

  const totalTaskMs = pairs.reduce((s, p) => s + p.durationMs, 0);
  const durationSec = Math.round(sessionDurationMs / 1000);

  return (
    <div className="space-y-8">
      {/* 헤더 */}
      <header className="space-y-1">
        <Link
          href={`/dashboard/${projectId}/sessions`}
          className="text-sm text-muted hover:text-text"
        >
          ← Sessions
        </Link>
        <div className="flex items-baseline gap-3 flex-wrap mt-1">
          <h1 className="text-2xl font-bold">Session detail</h1>
          <span className="font-mono text-xs text-muted">{sessionId}</span>
        </div>
        <div className="text-sm text-muted flex flex-wrap gap-4">
          <span>{new Date(session.startedAt).toLocaleString()}</span>
          {durationSec > 0 && <span>{formatDuration(durationSec)}</span>}
          {session.userName && <span>{session.userName}</span>}
          {session.messageCount != null && session.messageCount > 0 && (
            <Link
              href={`/dashboard/${projectId}/sessions/${sessionId}/transcript`}
              className="text-accent hover:underline"
            >
              대화 내역 {session.messageCount}개 →
            </Link>
          )}
        </div>
      </header>

      {/* 요약 카드 */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="이벤트" value={session.eventCount.toLocaleString()} />
        <StatCard label="총 토큰" value={formatTokens(totalTokens)} />
        <StatCard
          label="추정 비용"
          value={`$${session.estimatedCostUsd.toFixed(4)}`}
        />
        <StatCard
          label="툴 호출"
          value={pairs.length.toLocaleString()}
        />
      </section>

      {/* 프로젝트 기준 대비 느린 툴 */}
      {session.baselineComparison && session.baselineComparison.length > 0 && (
        <section className="bg-amber-950/20 border border-amber-900/40 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-amber-400 mb-2">
            ⚠ 프로젝트 기준 대비 느린 툴
          </h2>
          <ul className="space-y-1">
            {session.baselineComparison.map((b) => (
              <li key={b.toolName} className="text-sm flex justify-between">
                <span className="font-mono">{b.toolName}</span>
                <span className="text-amber-400">
                  {b.ratio}x 느림
                  <span className="text-muted ml-2 text-xs">
                    ({formatMs(b.sessionMedianMs)} vs 기준 {formatMs(b.projectP50Ms)})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 토큰 breakdown 바 */}
      <section className="bg-panel border rounded-lg p-5 space-y-3">
        <h2 className="text-sm font-semibold">토큰 사용 분포</h2>
        <TokenStackBar
          items={[
            { label: "Input", value: session.inputTokens, color: "bg-blue-500" },
            { label: "Output", value: session.outputTokens, color: "bg-green-500" },
            { label: "Cache read", value: session.cacheReadInputTokens, color: "bg-cyan-500" },
            { label: "Cache write", value: session.cacheCreationInputTokens, color: "bg-teal-600" },
          ]}
          total={totalTokens}
        />

        {session.usageByModel.length > 0 && (
          <div className="pt-3 border-t space-y-2">
            {session.usageByModel.map((u) => {
              const modelTotal = u.inputTokens + u.outputTokens;
              const pct = totalTokens > 0 ? (modelTotal / totalTokens) * 100 : 0;
              return (
                <div key={u.model} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-mono">
                      {u.model}
                      {u.isSubagent && (
                        <span className="ml-2 text-purple-300 bg-purple-950/40 border border-purple-900 px-1.5 py-0.5 rounded">
                          subagent
                        </span>
                      )}
                    </span>
                    <span className="text-muted">
                      {formatTokens(modelTotal)} · ${u.estimatedCostUsd.toFixed(4)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-bg rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${u.isSubagent ? "bg-purple-500" : "bg-accent"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 액티비티 리본 */}
      {ribbonSegments.length > 0 && (
        <section className="bg-panel border rounded-lg p-5 space-y-1">
          <h2 className="text-sm font-semibold mb-3">툴 호출 타임라인</h2>
          <ActivityRibbon segments={ribbonSegments} />
        </section>
      )}

      {/* 작업 타입별 요약 */}
      {pairs.length > 0 && (
        <section className="bg-panel border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">작업 분석</h2>
            <span className="text-xs text-muted">
              총 작업시간 {formatMs(totalTaskMs)}
            </span>
          </div>
          <div className="px-4 py-3 flex flex-wrap gap-4">
            {Object.entries(toolSummary).map(([key, val]) => (
              <div key={key} className="text-xs flex items-center gap-2">
                <ColorDot colorKey={key as ColorKey} />
                <span className="text-muted capitalize">{key}</span>
                <span className="font-medium">{val.count}회</span>
                <span className="text-muted">{formatMs(val.totalMs)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 이벤트 로그 (Pre+Post 병합) */}
      <section>
        <h2 className="text-sm font-semibold mb-2">
          이벤트 로그
          <span className="text-muted font-normal ml-2">
            {eventData.total}개
            {eventData.total > 500 && " (500개까지 표시)"}
          </span>
        </h2>

        {eventPairRows.length === 0 ? (
          <div className="bg-panel border rounded-lg p-8 text-center text-muted text-sm">
            이벤트가 없습니다.
          </div>
        ) : (
          <div className="bg-panel border rounded-lg overflow-hidden">
            <MergedEventList rows={eventPairRows} />
          </div>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 서브 컴포넌트
// ─────────────────────────────────────────────────────────

function TokenStackBar({
  items,
  total,
}: {
  items: Array<{ label: string; value: number; color: string }>;
  total: number;
}) {
  if (total === 0) return null;
  return (
    <div className="space-y-2">
      <div className="h-4 flex rounded-full overflow-hidden gap-px">
        {items
          .filter((i) => i.value > 0)
          .map((item) => (
            <div
              key={item.label}
              className={`${item.color} opacity-80`}
              style={{ width: `${(item.value / total) * 100}%` }}
              title={`${item.label}: ${item.value.toLocaleString()}`}
            />
          ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {items
          .filter((i) => i.value > 0)
          .map((item) => (
            <div key={item.label} className="flex items-center gap-1.5 text-xs">
              <div className={`w-2.5 h-2.5 rounded-sm ${item.color} opacity-80`} />
              <span className="text-muted">{item.label}</span>
              <span className="tabular-nums">{formatTokens(item.value)}</span>
              <span className="text-muted">
                ({((item.value / total) * 100).toFixed(1)}%)
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

const COLOR_DOT_MAP: Record<ColorKey, string> = {
  read: "bg-blue-500",
  bash: "bg-orange-500",
  edit: "bg-green-500",
  skill: "bg-amber-400",
  agent: "bg-purple-500",
  other: "bg-gray-500",
};

function ColorDot({ colorKey: k }: { colorKey: ColorKey }) {
  return <div className={`w-2 h-2 rounded-full shrink-0 ${COLOR_DOT_MAP[k]}`} />;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel border rounded-lg p-4">
      <div className="text-muted text-xs uppercase tracking-wider">{label}</div>
      <div className="text-lg font-bold mt-1">{value}</div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
