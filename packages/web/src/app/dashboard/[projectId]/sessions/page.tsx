import Link from "next/link";
import { serverFetch } from "@/lib/server-api";
import type { SessionList } from "@mytool/shared";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default async function SessionsPage({ params }: PageProps) {
  const { projectId } = await params;
  const data = await serverFetch<SessionList>(
    `/api/projects/${projectId}/dashboard/sessions?limit=50`,
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Sessions</h1>
        <p className="text-muted text-sm">
          {data.total.toLocaleString()} session{data.total === 1 ? "" : "s"} in
          the last 30 days
        </p>
      </header>

      {data.sessions.length === 0 ? (
        <div className="bg-panel border rounded-lg p-8 text-center text-muted">
          No sessions yet. Run a Claude Code session in a tracked project.
        </div>
      ) : (
        <div className="bg-panel border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted uppercase tracking-wider border-b">
              <tr>
                <th className="text-left px-4 py-2">Started</th>
                <th className="text-left px-4 py-2">User</th>
                <th className="text-right px-4 py-2">Events</th>
                <th className="text-right px-4 py-2">Tokens</th>
                <th className="text-right px-4 py-2">Cost</th>
                <th className="text-right px-4 py-2">Outliers</th>
                <th className="text-left px-4 py-2">Session ID</th>
              </tr>
            </thead>
            <tbody>
              {data.sessions.map((s) => (
                <tr
                  key={s.id}
                  className="border-b last:border-b-0 hover:bg-bg/50 transition-colors"
                >
                  <td className="px-4 py-2 whitespace-nowrap">
                    <Link
                      href={`/dashboard/${projectId}/sessions/${s.id}`}
                      className="hover:text-accent"
                    >
                      {new Date(s.startedAt).toLocaleString()}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{s.userName ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {s.eventCount}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {(s.inputTokens + s.outputTokens).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    ${s.estimatedCostUsd.toFixed(4)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {s.outlierCount == null ? (
                      <span className="text-muted">—</span>
                    ) : s.outlierCount === 0 ? (
                      <span className="text-muted">0</span>
                    ) : (
                      <span className="text-red-400">{s.outlierCount}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted">
                    {s.id.slice(0, 12)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
