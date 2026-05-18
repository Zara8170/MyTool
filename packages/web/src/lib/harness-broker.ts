// PR 5 — Harness run 이벤트 브로드캐스트 (in-memory).
// packages/api/src/lib/harness-broker.ts 와 동일 구현 — web (Next.js) 측.
//
// 자세한 설명은 api 측 파일 주석 참고. 핵심:
// - 같은 Node 프로세스 안에서만 broadcast.
// - Vercel multi-instance 환경에서 cross-instance pub/sub 은 추후 (PR 11).
// - globalThis 에 매단 싱글턴 — Next.js dev 의 HMR 안전.

import "server-only";
import type { HarnessStreamFrame } from "@mytool/shared";

type Listener = (frame: HarnessStreamFrame) => void;

class HarnessBroker {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(runId: string, listener: Listener): () => void {
    let set = this.listeners.get(runId);
    if (!set) {
      set = new Set();
      this.listeners.set(runId, set);
    }
    set.add(listener);
    return () => {
      const s = this.listeners.get(runId);
      if (!s) return;
      s.delete(listener);
      if (s.size === 0) this.listeners.delete(runId);
    };
  }

  publish(runId: string, frame: HarnessStreamFrame): void {
    const set = this.listeners.get(runId);
    if (!set || set.size === 0) return;
    for (const listener of set) {
      try {
        listener(frame);
      } catch (err) {
        console.error("[harness-broker] listener threw:", err);
      }
    }
  }

  subscriberCount(runId: string): number {
    return this.listeners.get(runId)?.size ?? 0;
  }
}

const GLOBAL_KEY = "__mytool_harness_broker__";
type GlobalWithBroker = typeof globalThis & {
  [GLOBAL_KEY]?: HarnessBroker;
};

function getOrInit(): HarnessBroker {
  const g = globalThis as GlobalWithBroker;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new HarnessBroker();
  }
  return g[GLOBAL_KEY];
}

export const harnessBroker = getOrInit();
