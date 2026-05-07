import { getRequiredUserId, getDashboardSummary, getUsageSeries, getForgottenSkills } from "@/lib/server-queries";
import { TokenUsageChart } from "@/components/token-usage-chart";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default async function OverviewPage({ params }: PageProps) {
  const { projectId } = await params;
  const userId = await getRequiredUserId();

  const [summary, usage, forgottenSkills] = await Promise.all([
    getDashboardSummary(projectId, userId),
    getUsageSeries(projectId, userId),
    getForgottenSkills(projectId, userId, userId),
  ]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Overview</h1>
        <p className="text-muted text-sm">Last 30 days</p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Sessions"
          value={summary.totalSessions.toLocaleString()}
        />
        <StatCard
          label="Total tokens"
          value={formatTokens(
            summary.totalInputTokens +
              summary.totalOutputTokens +
              summary.totalCacheReadTokens +
              summary.totalCacheCreationTokens,
          )}
        />
        <StatCard
          label="Estimated cost"
          value={`$${summary.estimatedCostUsd.toFixed(2)}`}
          hint="API price estimate, not actual subscription billing"
        />
        <StatCard label="Active users" value={summary.activeUsers.toString()} />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Daily token usage</h2>
        <div className="bg-panel border rounded-lg p-4">
          <TokenUsageChart series={usage.series} />
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <TopList
          title="Top skills"
          rows={summary.topSkills.map((s) => ({
            label: s.skillName,
            value: s.callCount,
          }))}
          empty="No skill calls yet."
        />
        <TopList
          title="Top agent types"
          rows={summary.topAgentTypes.map((a) => ({
            label: a.agentType,
            value: a.callCount,
          }))}
          empty="No agent calls yet."
        />
      </section>

      {forgottenSkills.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-1">최근 1주일 동안 쓰지 않은 스킬</h2>
          <p className="text-xs text-muted mb-3">
            지난 4주 동안 사용했지만 최근 7일 동안 사용하지 않은 스킬입니다.
          </p>
          <div className="bg-panel border rounded-lg p-4">
            <ul className="space-y-1.5">
              {forgottenSkills.map((s) => (
                <li key={s.skillName} className="flex justify-between text-sm border-b last:border-b-0 pb-1.5 last:pb-0">
                  <span className="font-mono">{s.skillName}</span>
                  <span className="text-muted text-xs">
                    마지막 사용: {new Date(s.lastUsedAt).toLocaleDateString("ko-KR")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-panel border rounded-lg p-4">
      <div className="text-muted text-xs uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {hint && <div className="text-xs text-muted mt-1">{hint}</div>}
    </div>
  );
}

function TopList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: Array<{ label: string; value: number }>;
  empty: string;
}) {
  return (
    <div className="bg-panel border rounded-lg p-4">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {rows.length === 0 ? (
        <div className="text-muted text-sm">{empty}</div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li
              key={r.label}
              className="flex justify-between text-sm border-b last:border-b-0 pb-1.5 last:pb-0"
            >
              <span className="font-mono">{r.label}</span>
              <span className="text-muted">{r.value.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
