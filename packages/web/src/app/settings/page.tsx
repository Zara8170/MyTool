import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthToken } from "@/lib/auth";
import { verifyJwt } from "@/lib/jwt";
import { prisma } from "@/lib/db";
import { LogoutButton } from "@/components/logout-button";
import { DeleteProjectButton } from "@/components/delete-project-button";

export default async function SettingsPage() {
  const token = await getAuthToken();
  if (!token) redirect("/login");

  let userId: string;
  try {
    const payload = await verifyJwt(token);
    userId = payload.sub;
  } catch {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        include: {
          org: { include: { projects: true } },
        },
      },
    },
  });
  if (!user) redirect("/login");

  const allProjects = user.memberships.flatMap((m) => m.org.projects);

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <header className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted text-sm">{user.email}</p>
        </div>
        <LogoutButton />
      </header>

      {allProjects.length > 0 && (
        <section className="bg-panel border rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-3">Projects</h2>
          <ul className="space-y-1">
            {allProjects.map((p) => (
              <li key={p.id} className="flex justify-between items-center py-1">
                <Link
                  href={`/dashboard/${p.id}`}
                  className="text-sm hover:text-accent flex-1"
                >
                  {p.name}
                </Link>
                <div className="flex items-center gap-3">
                  <Link href={`/dashboard/${p.id}`} className="text-muted text-xs hover:text-accent">
                    Dashboard →
                  </Link>
                  <DeleteProjectButton projectId={p.id} projectName={p.name} />
                </div>
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
          {user.memberships.map((m) => (
            <li
              key={m.id}
              className="flex justify-between border-b last:border-b-0 pb-1 last:pb-0"
            >
              <span>{m.org.name}</span>
              <span className="text-muted text-xs">{m.role}</span>
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
