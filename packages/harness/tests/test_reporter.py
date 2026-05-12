import json
from unittest.mock import patch, MagicMock

from claude_harness.reporter import (
    HttpReporter,
    NullReporter,
    make_reporter,
)


def test_null_reporter_emit_is_noop():
    # 단순히 예외 없이 끝나면 통과
    NullReporter().emit("ideation", "info", {"k": "v"})


def test_make_reporter_returns_null_without_options():
    rep = make_reporter(None, None)
    assert isinstance(rep, NullReporter)


def test_make_reporter_returns_http_when_both_given():
    rep = make_reporter("https://x/y", "tok")
    assert isinstance(rep, HttpReporter)
    assert rep.url == "https://x/y"
    assert rep.token == "tok"


def test_make_reporter_warns_when_only_one_given(capsys):
    rep = make_reporter("https://x/y", None)
    assert isinstance(rep, NullReporter)
    err = capsys.readouterr().err
    assert "must be provided together" in err

    rep2 = make_reporter(None, "tok")
    assert isinstance(rep2, NullReporter)
    err2 = capsys.readouterr().err
    assert "must be provided together" in err2


def test_http_reporter_posts_json_with_bearer():
    rep = HttpReporter(url="https://x/y", token="tok123")
    fake_resp = MagicMock()
    fake_resp.status = 200
    fake_resp.__enter__ = lambda self: self
    fake_resp.__exit__ = lambda *a: False

    with patch("claude_harness.reporter.urlrequest.urlopen", return_value=fake_resp) as mock_open:
        rep.emit("build", "info", {"req_id": "r1", "iter": 3})
        mock_open.assert_called_once()
        req_obj = mock_open.call_args.args[0]
        # urllib.request.Request
        assert req_obj.get_method() == "POST"
        assert req_obj.headers["Authorization"] == "Bearer tok123"
        assert req_obj.headers["Content-type"] == "application/json"
        body = json.loads(req_obj.data.decode("utf-8"))
        assert body["phase"] == "build"
        assert body["level"] == "info"
        assert body["payload"] == {"req_id": "r1", "iter": 3}
        assert body["ts"].endswith("Z")


def test_http_reporter_swallows_url_error(capsys):
    from urllib.error import URLError

    rep = HttpReporter(url="https://x/y", token="t")
    with patch(
        "claude_harness.reporter.urlrequest.urlopen",
        side_effect=URLError("boom"),
    ):
        # 예외가 밖으로 새지 않아야 함
        rep.emit("verify", "warn", {"passed": False})
    err = capsys.readouterr().err
    assert "failed to POST phase=verify" in err


def test_http_reporter_warns_on_non_2xx(capsys):
    rep = HttpReporter(url="https://x/y", token="t")
    fake_resp = MagicMock()
    fake_resp.status = 503
    fake_resp.__enter__ = lambda self: self
    fake_resp.__exit__ = lambda *a: False
    with patch("claude_harness.reporter.urlrequest.urlopen", return_value=fake_resp):
        rep.emit("report", "info", {"outcome": "pass"})
    err = capsys.readouterr().err
    assert "non-2xx response 503" in err
