"""Run progress reporter.

mytool API 가 spawn 한 경우 `--report-url` / `--report-token` 으로
phase 전이마다 HTTP POST 호출. 옵션이 없으면 NullReporter — 기존 stdout
동작만 유지하고 네트워크 호출 없음.

설계 원칙:
- 외부 deps 추가 금지 (stdlib urllib 만 사용). harness 단독 설치 시 부담 최소.
- fail-open: 보고 실패해도 harness 사이클은 계속. 사용자 작업이 인질
  잡히지 않는다 (integration-plan §3a.5 의 fail-open 정책과 동일).
- 타임아웃 짧게 (5s). 일본 리전 RTT + cold start 감안.
"""
from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass
from typing import Any, Optional, Protocol
from urllib import error as urlerror
from urllib import request as urlrequest


class Reporter(Protocol):
    """Phase 전이 보고 인터페이스."""

    def emit(self, phase: str, level: str, payload: dict[str, Any]) -> None: ...


class NullReporter:
    """No-op. `--report-url` 미지정 시 사용."""

    def emit(self, phase: str, level: str, payload: dict[str, Any]) -> None:  # noqa: D401
        return None


@dataclass
class HttpReporter:
    """HTTP POST 로 mytool API 에 phase 전이 보고.

    payload schema (mytool 측 `POST /api/harness/runs/:runId/events` 와 1:1):
        {
          "phase": "ideation" | "build" | "verify" | "report",
          "level": "info" | "warn" | "error",
          "ts":    "<ISO-8601 UTC>",
          "payload": <event-specific data>
        }
    """

    url: str
    token: str
    timeout_s: float = 5.0

    def emit(self, phase: str, level: str, payload: dict[str, Any]) -> None:
        body = {
            "phase": phase,
            "level": level,
            "ts": _iso_utc_now(),
            "payload": payload,
        }
        data = json.dumps(body).encode("utf-8")
        req = urlrequest.Request(
            self.url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}",
            },
            method="POST",
        )
        try:
            with urlrequest.urlopen(req, timeout=self.timeout_s) as resp:
                # 2xx 외의 응답도 fail-open — 사용자에게는 한 줄만 알림
                if resp.status >= 300:
                    print(
                        f"[reporter] non-2xx response {resp.status} for phase={phase}",
                        file=sys.stderr,
                    )
        except (urlerror.URLError, TimeoutError, OSError) as exc:
            print(f"[reporter] failed to POST phase={phase}: {exc}", file=sys.stderr)


def make_reporter(url: Optional[str], token: Optional[str]) -> Reporter:
    """CLI 옵션을 받아 적절한 Reporter 생성.

    url 과 token 이 모두 있으면 HttpReporter, 아니면 NullReporter.
    한쪽만 있는 경우는 의도치 않은 설정 가능성 — 경고 후 NullReporter.
    """
    if url and token:
        return HttpReporter(url=url, token=token)
    if url or token:
        print(
            "[reporter] --report-url and --report-token must be provided together; "
            "disabling HTTP reporting.",
            file=sys.stderr,
        )
    return NullReporter()


def _iso_utc_now() -> str:
    # stdlib 만으로 timezone-aware ISO-8601 UTC. Python 3.11+ 보장.
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
