import { prisma } from "../db.js";

export interface OutlierStats {
  outlierCount: number;
  outlierRatio: number;
}

/**
 * 세션의 Pre/PostToolUse 페어를 조회해 이상치를 계산하고 개별 로그로 저장한다.
 * 기준: durationMs > median(모든 페어 소요시간) * 10
 * 멱등성: 기존 outlier 이벤트를 삭제 후 재삽입
 */
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
      select: { timestamp: true },
      orderBy: { timestamp: "asc" },
    }),
  ]);

  if (preEvents.length === 0) {
    return { outlierCount: 0, outlierRatio: 0 };
  }

  const usedPostIndices = new Set<number>();
  const pairs: { toolName: string | null; durationMs: number }[] = [];

  for (const pre of preEvents) {
    const preTime = pre.timestamp.getTime();
    for (let i = 0; i < postEvents.length; i++) {
      if (usedPostIndices.has(i)) continue;
      const postTime = postEvents[i]!.timestamp.getTime();
      if (postTime >= preTime) {
        pairs.push({ toolName: pre.toolName, durationMs: postTime - preTime });
        usedPostIndices.add(i);
        break;
      }
    }
  }

  if (pairs.length === 0) {
    return { outlierCount: 0, outlierRatio: 0 };
  }

  const sorted = [...pairs].sort((a, b) => a.durationMs - b.durationMs);
  const medianMs = sorted[Math.floor(sorted.length / 2)]?.durationMs ?? 1;
  const threshold = medianMs * 10;

  const outliers = pairs.filter((p) => p.durationMs > threshold);

  // 멱등성: 기존 레코드 삭제 후 재삽입 (원자성 보장)
  await prisma.$transaction(async (tx) => {
    await tx.sessionOutlierEvent.deleteMany({ where: { sessionId } });
    if (outliers.length > 0) {
      await tx.sessionOutlierEvent.createMany({
        data: outliers.map((o) => ({
          sessionId,
          projectId,
          toolName: o.toolName ?? "unknown",
          durationMs: o.durationMs,
          medianMs,
        })),
      });
    }
  });

  return {
    outlierCount: outliers.length,
    outlierRatio: outliers.length / pairs.length,
  };
}
