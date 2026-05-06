import { redirect } from "next/navigation";
import { getAuthToken } from "@/lib/auth";
import { verifyJwt } from "@/lib/jwt";
import { prisma } from "@/lib/db";

export default async function HomePage() {
  const token = await getAuthToken();
  if (!token) redirect("/login");

  let userId: string;
  try {
    const payload = await verifyJwt(token);
    userId = payload.sub;
  } catch {
    redirect("/login");
  }

  const membership = await prisma.orgMembership.findFirst({
    where: { userId },
    include: { org: { include: { projects: { take: 1 } } } },
  });

  if (!membership) redirect("/login");

  const project = membership.org.projects[0];
  if (!project) redirect("/settings");

  redirect(`/dashboard/${project.id}`);
}
