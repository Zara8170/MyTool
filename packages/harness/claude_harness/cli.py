import click
from pathlib import Path
from claude_harness.config import HarnessConfig
from claude_harness.reporter import make_reporter
from claude_harness.runner import run_loop

HARNESS_TEMPLATE = """\
project: my-project
verify_cmd: "npm run build && npm test"

requirements:
  - id: req-001
    title: "첫 번째 요구사항"
    description: "상세 설명을 여기에"
    status: pending
  - id: req-002
    title: "두 번째 요구사항"
    status: pending
"""


@click.group()
def main():
    pass


@main.command()
def init():
    target = Path.cwd() / "harness.yaml"
    if target.exists():
        click.echo("harness.yaml already exists. Skipping.")
        return
    target.write_text(HARNESS_TEMPLATE, encoding="utf-8")
    click.echo(f"Created harness.yaml at {target}")
    click.echo("Edit requirements, then run: harness run")


@main.command()
@click.option("--config", default="harness.yaml", help="Path to harness.yaml")
@click.option(
    "--report-url",
    default=None,
    envvar="HARNESS_REPORT_URL",
    help="mytool API event URL. phase transitions are POSTed here.",
)
@click.option(
    "--report-token",
    default=None,
    envvar="HARNESS_REPORT_TOKEN",
    help="mytool API run-scoped bearer token. Required with --report-url.",
)
def run(config, report_url, report_token):
    config_path = Path(config)
    if not config_path.exists():
        click.echo(f"Error: {config} not found. Run 'harness init' first.", err=True)
        raise SystemExit(1)
    harness_config = HarnessConfig.load(config_path)
    reporter = make_reporter(report_url, report_token)
    run_loop(harness_config, cwd=Path.cwd(), reporter=reporter)
