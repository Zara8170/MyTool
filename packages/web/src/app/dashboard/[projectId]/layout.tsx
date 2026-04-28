import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthToken } from "@/lib/auth";
import { serverFetch, ServerApiError } from "@/lib/server-api";
import type { MeResponse, Project } from "@mytool/shared";
import { LogoutButton } from "@/components/logout-button";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}

export default async function DashboardLayout({ children, params }: LayoutProps) {
  const { projectId } = await params;
  const token = await getAuthToken();
  if (!token) redirect("/login");

  try {
    const [me, project] = await Promise.all([
      serverFetch<MeResponse>("/api/auth/me", { next: { revalidate: 60 } }),
      serverFetch<Project>(`/api/projects/${projectId}`, { next: { revalidate: 30 } }),
    ]);

    return (
      <div className="min-h-screen flex">
        <aside className="w-56 border-r p-4 flex flex-col">
          <div className="text-lg font-bold mb-1">mytool</div>
          <div className="text-xs text-muted mb-6">{me.email}</div>

          <div className="text-xs text-muted uppercase tracking-wider mb-2">
            Project
          </div>
          <div className="text-sm font-medium mb-4">{project.name}</div>

          <nav className="flex flex-col gap-1 text-sm">
            <SidebarLink href={`/dashboard/${projectId}`} label="Overview" />
            <SidebarLink
              href={`/dashboard/${projectId}/sessions`}
              label="Sessions"
            />
            <SidebarLink
              href={`/dashboard/${projectId}/skills`}
              label="Skills"
            />
          </nav>

          <div className="mt-auto pt-4 flex flex-col gap-2">
            <SidebarLink href="/settings" label="Settings" />
            <LogoutButton />
          </div>
        </aside>

        <main className="flex-1 p-8 overflow-auto">{children}</main>
      </div>
    );
  } catch (err) {
    if (err instanceof ServerApiError && err.status === 401) {
      redirect("/login");
    }
    throw err;
  }
}

function SidebarLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="px-2 py-1.5 rounded hover:bg-panel transition-colors"
    >
      {label}
    </Link>
  );
}
