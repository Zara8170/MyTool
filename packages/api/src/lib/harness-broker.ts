// PR 5 — Harness run 이벤트 브로드캐스트 (in-memory).
//
// 흐름:
//   harness CLI ──POST events──> POST /api/harness/runs/:runId/events
//                                  │
//                                  └── prisma.create (영속화)
//                                  └── broker.publish(runId, frame)
//
//   web 클라이언트 ──GET stream──> GET /api/harness/runs/:runId/stream (SSE)
//                                  │
//                                  └── broker.subscribe(runId, listener)
//
// 한계 (의도된 제약):
// - 같은 Node 프로세스 안에서만 broadcast. Vercel 의 multi-instance 환경에서는
//   다른 instance 에서 들어온 event 가 다른 instance 의 SSE 구독자에게 안 갈 수 있음.
//   해결책 (PR 11 daemon 또는 후속): Redis pubsub / Supabase Realtime / 또는 polling fallback.
//   지금 단계에서는 "self-hosted 단일 인스턴스" 또는 "Vercel sticky session" 가정.
// - 메모리만 사용. 재시작 시 진행 중인 SSE 구독은 끊김. CLI 는 재시도로 복구.
//
// SSE 구독자가 처음 연결될 때는 DB 의 기존 이벤트를 한 번에 replay (snapshot frame)
// 한 뒤 broker 의 live frame 을 받기 시작한다. replay 와 live 사이의 race
// 는 라우트가 broker.subscribe 등록 → DB read → snapshot 전송 → live 이어받기
// 순서로 해소한다.

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
    // 동기 호출. listener 가 throw 해도 다른 listener 에 영향 없도록 try/catch.
    for (const listener of set) {
      try {
        listener(frame);
      } catch (err) {
        console.error("[harness-broker] listener threw:", err);
      }
    }
  }

  /** 디버그·테스트용. */
  subscriberCount(runId: string): number {
    return this.listeners.get(runId)?.size ?? 0;
  }
}

/**
 * 전역 싱글턴. Next.js dev 의 HMR / 다중 import 에서도 같은 인스턴스를
 * 쓰도록 `globalThis` 에 매단다. (prisma 클라이언트가 같은 방식.)
 */
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
