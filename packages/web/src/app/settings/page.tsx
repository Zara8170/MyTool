import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthToken } from "@/lib/auth";
import { serverFetch } from "@/lib/server-api";
import type { MeResponse } from "@mytool/shared";
import { LogoutButton } from "@/components/logout-button";

interface Project {
  id: string;
  name: string;
  slug: string;
}

export default async function SettingsPage() {
  const token = await getAuthToken();
  if (!token) redirect("/login");

  const me = await serverFetch<MeResponse>("/api/auth/me");

  const projectsByOrg = await Promise.all(
    me.organizations.map(async (org) => {
      const data = await serverFetch<{ projects: Project[] }>(
        `/api/orgs/${org.id}/projects`,
      );
      return { org, projects: data.projects };
    }),
  );

  const allProjects = projectsByOrg.flatMap((x) => x.projects);

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <header className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted text-sm">{me.email}</p>
        </div>
        <LogoutButton />
      </header>

      {allProjects.length > 0 && (
        <section className="bg-panel border rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-3">Projects</h2>
          <ul className="space-y-1">
            {allProjects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/dashboard/${p.id}`}
                  className="flex justify-between items-center text-sm hover:text-accent py-1"
                >
                  <span>{p.name}</span>
                  <span className="text-muted text-xs">Dashboard →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bg-panel border rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold">Get started</h2>
        <p className="text-sm text-muted">
          Run the CLI in your code project to create a tracked project:
        </p>
        <pre className="bg-bg border rounded p-3 text-xs overflow-auto">
          npm install -g mytool-ai{"\n"}
          cd /path/to/your/code/project{"\n"}
          mytool
        </pre>
        <p className="text-sm text-muted">
          The CLI will guide you through linking the project to your account
          and installing the Claude Code hooks.
        </p>
      </section>

      <section className="bg-panel border rounded-lg p-4">
        <h2 className="text-sm font-semibold mb-3">Your organizations</h2>
        <ul className="space-y-1 text-sm">
          {me.organizations.map((o) => (
            <li
              key={o.id}
              className="flex justify-between border-b last:border-b-0 pb-1 last:pb-0"
            >
              <span>{o.name}</span>
              <span className="text-muted text-xs">{o.role}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-panel border rounded-lg p-4">
        <h2 className="text-sm font-semibold mb-3">Security</h2>
        <Link
          href="/settings/sessions"
          className="flex justify-between items-center text-sm hover:text-accent"
        >
          <div>
            <div>Manage active sessions</div>
            <div className="text-xs text-muted">
              View browsers and CLIs that are signed in. Revoke any you don&apos;t recognize.
            </div>
          </div>
          <span className="text-muted">→</span>
        </Link>
      </section>
    </main>
  );
}
