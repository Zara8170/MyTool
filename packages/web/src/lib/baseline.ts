import "server-only";
import { prisma } from "./db";

const EXCLUDED_TOOLS = new Set(["Agent"]);
const MIN_SAMPLES = 10;

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

export async function updateProjectToolBaselines(projectId: string): Promise<void> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const [preEvents, postEvents] = await Promise.all([
    prisma.event.findMany({
      where: {
        projectId,
        hookEventName: "PreToolUse",
        timestamp: { gte: since },
        toolName: { notIn: [...EXCLUDED_TOOLS] },
      },
      select: { toolName: true, timestamp: true, sessionId: true },
      orderBy: { timestamp: "asc" },
    }),
    prisma.event.findMany({
      where: {
        projectId,
        hookEventName: "PostToolUse",
        timestamp: { gte: since },
        toolName: { notIn: [...EXCLUDED_TOOLS] },
      },
      select: { toolName: true, timestamp: true, sessionId: true },
      orderBy: { timestamp: "asc" },
    }),
  ]);

  const postBuckets = new Map<string, { timestamp: Date }[]>();
  for (const post of postEvents) {
    const key = `${post.sessionId}__${post.toolName ?? "__none__"}`;
    if (!postBuckets.has(key)) postBuckets.set(key, []);
    postBuckets.get(key)!.push(post);
  }

  const usedIndices = new Map<string, Set<number>>();
  const toolDurations = new Map<string, number[]>();

  for (const pre of preEvents) {
    const bucketKey = `${pre.sessionId}__${pre.toolName ?? "__none__"}`;
    const bucket = postBuckets.get(bucketKey) ?? [];
    if (!usedIndices.has(bucketKey)) usedIndices.set(bucketKey, new Set());
    const used = usedIndices.get(bucketKey)!;
    const preTime = pre.timestamp.getTime();

    for (let i = 0; i < bucket.length; i++) {
      if (used.has(i)) continue;
      const postTime = bucket[i]!.timestamp.getTime();
      if (postTime >= preTime) {
        const toolKey = pre.toolName ?? "__none__";
        if (!toolDurations.has(toolKey)) toolDurations.set(toolKey, []);
        toolDurations.get(toolKey)!.push(postTime - preTime);
        used.add(i);
        break;
      }
    }
  }

  for (const [toolName, durations] of toolDurations) {
    if (durations.length < MIN_SAMPLES) continue;
    const sorted = [...durations].sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);

    await prisma.projectToolBaseline.upsert({
      where: { projectId_toolName: { projectId, toolName } },
      create: { projectId, toolName, p50Ms: p50, p95Ms: p95, sampleCount: durations.length },
      update: { p50Ms: p50, p95Ms: p95, sampleCount: durations.length },
    });
  }
}
