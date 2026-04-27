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
      select: { toolName: true, timestamp: true },
      orderBy: { timestamp: "asc" },
    }),
  ]);

  if (preEvents.length === 0) {
    return { outlierCount: 0, outlierRatio: 0 };
  }

  // 툴 이름별 버킷으로 매칭 — 서브에이전트 병렬 실행 시 다른 툴의 Post와 교차 매칭되는 것을 방지
  const postBuckets = new Map<string, { timestamp: Date }[]>();
  for (const post of postEvents) {
    const key = post.toolName ?? "__none__";
    if (!postBuckets.has(key)) postBuckets.set(key, []);
    postBuckets.get(key)!.push(post);
  }

  const usedPostIndices = new Map<string, Set<number>>();
  const pairs: { toolName: string | null; durationMs: number }[] = [];

  // Agent는 작업 규모에 따라 소요시간 편차가 너무 커서 상대적 임계치 기반 이상치 탐지가 무의미함
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
    // 매칭된 Post가 없는 Pre는 건너뜀 — 가짜 1500ms 기본값으로 중앙값이 왜곡되는 것을 방지
  }

  if (pairs.length === 0) {
    return { outlierCount: 0, outlierRatio: 0 };
  }

  // 툴 타입별 중앙값으로 비교 — Bash는 Bash끼리, Edit는 Edit끼리
  // 같은 툴이 3개 미만이면 중앙값 신뢰도가 낮으므로 이상치 판정 스킵
  const MIN_SAMPLES = 3;
  const toolGroups = new Map<string, { toolName: string | null; durationMs: number }[]>();
  for (const pair of pairs) {
    const key = pair.toolName ?? "__none__";
    if (!toolGroups.has(key)) toolGroups.set(key, []);
    toolGroups.get(key)!.push(pair);
  }

  // 프로젝트 기준선 조회 (MIN_SAMPLES 미달 툴에 fallback으로 사용)
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
      // 샘플 부족 → 프로젝트 기준선 fallback
      const baseline = baselineMap.get(toolKey);
      if (!baseline) continue;
      medianMs = baseline;
    }

    eligiblePairs += group.length;
    const threshold = medianMs * 10;

    for (const pair of group) {
      if (pair.durationMs > threshold) {
        outliers.push({ ...pair, medianMs });
      }
    }
  }

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
