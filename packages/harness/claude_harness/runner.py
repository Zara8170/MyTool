import time
from pathlib import Path
from typing import Optional

from claude_harness.config import HarnessConfig
from claude_harness.phases.ideation import select_next
from claude_harness.phases.build import save_head, invoke_claude
from claude_harness.phases.verify import run_verify
from claude_harness.phases.report import handle_pass, handle_fail
from claude_harness.reporter import NullReporter, Reporter

SLEEP_BETWEEN_ITERATIONS = 10


def run_once(
    config: HarnessConfig,
    iter_n: int,
    cwd: Path,
    reporter: Optional[Reporter] = None,
) -> str:
    rep = reporter or NullReporter()

    req = select_next(config)
    if req is None:
        rep.emit("ideation", "info", {"iter": iter_n, "result": "no_pending"})
        return "done"

    rep.emit(
        "ideation",
        "info",
        {"iter": iter_n, "selected": {"id": req.id, "title": req.title}},
    )

    print(f"\n[Iteration {iter_n}] Building: {req.id} - {req.title}")
    head = save_head(cwd)
    rep.emit(
        "build",
        "info",
        {"iter": iter_n, "req_id": req.id, "saved_head": head, "stage": "start"},
    )
    invoke_claude(req, cwd)
    rep.emit("build", "info", {"iter": iter_n, "req_id": req.id, "stage": "done"})

    rep.emit("verify", "info", {"iter": iter_n, "req_id": req.id, "stage": "start"})
    passed = run_verify(config.verify_cmd, cwd)
    rep.emit(
        "verify",
        "info" if passed else "warn",
        {"iter": iter_n, "req_id": req.id, "passed": passed},
    )

    if passed:
        handle_pass(config, req, iter_n=iter_n, cwd=cwd)
        rep.emit(
            "report",
            "info",
            {"iter": iter_n, "req_id": req.id, "outcome": "pass"},
        )
        return "pass"
    else:
        handle_fail(config, req, saved_head=head, cwd=cwd)
        rep.emit(
            "report",
            "warn",
            {
                "iter": iter_n,
                "req_id": req.id,
                "outcome": "fail",
                "rolled_back_to": head,
            },
        )
        return "fail"


def run_loop(
    config: HarnessConfig,
    cwd: Path,
    reporter: Optional[Reporter] = None,
) -> None:
    rep = reporter or NullReporter()
    iter_n = 1
    print(f"[harness] Starting autonomous loop for project: {config.project}")
    rep.emit("ideation", "info", {"stage": "loop_start", "project": config.project})
    while True:
        result = run_once(config, iter_n=iter_n, cwd=cwd, reporter=rep)
        if result == "done":
            print("[harness] All requirements complete.")
            rep.emit("report", "info", {"stage": "loop_complete"})
            break
        iter_n += 1
        time.sleep(SLEEP_BETWEEN_ITERATIONS)
