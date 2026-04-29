import "server-only";
import { prisma } from "./db";

export interface OutlierStats {
  outlierCount: number;
  outlierRatio: number;
}

export async function computeSessionOutlierStats(
  sessionId: string,
  projectId: string,
): Promise<OutlierStats> {
  const [preEvents, postEvents] = await Promise.all([
    prisma.event.findMany({
      where: { sessionId, hookEventName: "PreToolUse" },
      select: { id: true, toolName: true, timestamp: true },
      orderBy: { timestamp: "asc" },
    }),
    prisma.event.findMany({
      where: { sessionId, hookEventName: "PostToolUse" },
      select: { toolName: true, timestamp: true },
      orderBy: { timestamp: "asc" },
    }),
  ]);

  if (preEvents.length === 0) return { outlierCount: 0, outlierRatio: 0 };

  const postBuckets = new Map<string, { timestamp: Date }[]>();
  for (const post of postEvents) {
    const key = post.toolName ?? "__none__";
    if (!postBuckets.has(key)) postBuckets.set(key, []);
    postBuckets.get(key)!.push(post);
  }

  const usedPostIndices = new Map<string, Set<number>>();
  const pairs: { toolName: string | null; durationMs: number }[] = [];
  const EXCLUDED_TOOLS = new Set(["Agent"]);

  for (const pre of preEvents) {
    if (EXCLUDED_TOOLS.has(pre.toolName ?? "")) continue;
    const key = pre.toolName ?? "__none__";
    const bucket = postBuckets.get(key) ?? [];
    if (!usedPostIndices.has(key)) usedPostIndices.set(key, new Set());
    const used = usedPostIndices.get(key)!;
    const preTime = pre.timestamp.getTime();

    for (let i = 0; i < bucket.length; i++) {
      if (used.has(i)) continue;
      const postTime = bucket[i]!.timestamp.getTime();
      if (postTime >= preTime) {
        pairs.push({ toolName: pre.toolName, durationMs: postTime - preTime });
        used.add(i);
        break;
      }
    }
  }

  if (pairs.length === 0) return { outlierCount: 0, outlierRatio: 0 };

  const MIN_SAMPLES = 3;
  const toolGroups = new Map<string, { toolName: string | null; durationMs: number }[]>();
  for (const pair of pairs) {
    const key = pair.toolName ?? "__none__";
    if (!toolGroups.has(key)) toolGroups.set(key, []);
    toolGroups.get(key)!.push(pair);
  }

  const projectBaselines = await prisma.projectToolBaseline.findMany({
    where: { projectId },
    select: { toolName: true, p50Ms: true },
  });
  const baselineMap = new Map(projectBaselines.map((b) => [b.toolName, b.p50Ms]));

  const outliers: { toolName: string | null; durationMs: number; medianMs: number }[] = [];
  let eligiblePairs = 0;

  for (const [toolKey, group] of toolGroups) {
    let medianMs: number;
    if (group.length >= MIN_SAMPLES) {
      const sorted = [...group].sort((a, b) => a.durationMs - b.durationMs);
      medianMs = sorted[Math.floor(sorted.length / 2)]!.durationMs;
    } else {
      const baseline = baselineMap.get(toolKey);
      if (!baseline) continue;
      medianMs = baseline;
    }

    eligiblePairs += group.length;
    const threshold = medianMs * 10;
    for (const pair of group) {
      if (pair.durationMs > threshold) outliers.push({ ...pair, medianMs });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.sessionOutlierEvent.deleteMany({ where: { sessionId } });
    if (outliers.length > 0) {
      await tx.sessionOutlierEvent.createMany({
        data: outliers.map((o) => ({
          sessionId,
          projectId,
          toolName: o.toolName ?? "unknown",
          durationMs: o.durationMs,
          medianMs: o.medianMs,
        })),
      });
    }
  });

  return {
    outlierCount: outliers.length,
    outlierRatio: eligiblePairs > 0 ? outliers.length / eligiblePairs : 0,
  };
}
