import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthToken } from "@/lib/auth";
import { serverFetch } from "@/lib/server-api";
import type { SessionListResponse } from "@mytool/shared";
import { RevokeButton } from "@/components/revoke-button";

export default async function SessionsPage() {
  const token = await getAuthToken();
  if (!token) redirect("/login");

  const data = await serverFetch<SessionListResponse>("/api/auth/sessions");

  const active = data.sessions.filter((s) => s.isActive);
  const inactive = data.sessions.filter((s) => !s.isActive);

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <header>
        <Link href="/settings" className="text-sm text-muted hover:text-text">
          ← Back to settings
        </Link>
        <h1 className="text-2xl font-bold mt-2">Active sessions</h1>
        <p className="text-muted text-sm">
          Browsers and CLIs currently signed in to your account.
        </p>
      </header>

      <section className="bg-panel border rounded-lg overflow-hidden">
        {active.length === 0 ? (
          <div className="p-6 text-sm text-muted text-center">
            No active sessions.
          </div>
        ) : (
          <ul className="divide-y">
            {active.map((s) => (
              <li
                key={s.id}
                className="p-4 flex items-start justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{s.label ?? "Unnamed"}</span>
                    <KindBadge kind={s.kind} />
                    {s.isCurrent && (
                      <span className="text-xs px-2 py-0.5 rounded bg-accent/20 text-accent">
                        This device
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted mt-1 space-x-3">
                    <span>Created {formatDate(s.createdAt)}</span>
                    <span>·</span>
                    <span>
                      Last used{" "}
                      {s.lastUsedAt ? formatDate(s.lastUsedAt) : "never"}
                    </span>
                    <span>·</span>
                    <span>Expires {formatDate(s.expiresAt)}</span>
                  </div>
                </div>
                {!s.isCurrent && (
                  <RevokeButton id={s.id} label={s.label ?? "this session"} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {inactive.length > 0 && (
        <section className="bg-panel border rounded-lg overflow-hidden">
          <header className="px-4 py-2 border-b">
            <h2 className="text-sm font-semibold text-muted">
              Inactive ({inactive.length})
            </h2>
          </header>
          <ul className="divide-y">
            {inactive.slice(0, 20).map((s) => (
              <li key={s.id} className="p-4 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-muted">{s.label ?? "Unnamed"}</span>
                  <KindBadge kind={s.kind} />
                  <span className="text-xs text-muted">
                    {s.revokedAt
                      ? `Revoked ${formatDate(s.revokedAt)}`
                      : `Expired ${formatDate(s.expiresAt)}`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-muted">
        Tip: web sessions expire after 7 days, CLI tokens after 1 year. Revoke
        any you don&apos;t recognize — that device will be signed out immediately.
      </p>
    </main>
  );
}

function KindBadge({ kind }: { kind: "web" | "cli" }) {
  const cls =
    kind === "web"
      ? "bg-blue-950/40 text-blue-300 border border-blue-900"
      : "bg-amber-950/40 text-amber-300 border border-amber-900";
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${cls}`}>
      {kind.toUpperCase()}
    </span>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}
