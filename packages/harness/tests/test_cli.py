from click.testing import CliRunner
from pathlib import Path
from claude_harness.cli import main


def test_init_creates_harness_yaml(tmp_path):
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path) as td:
        result = runner.invoke(main, ["init"])
        assert result.exit_code == 0
        assert (Path(td) / "harness.yaml").exists()
        assert "harness.yaml" in result.output


def test_init_skips_if_exists(tmp_path):
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path) as td:
        (Path(td) / "harness.yaml").write_text("exists")
        result = runner.invoke(main, ["init"])
        assert result.exit_code == 0
        assert "already exists" in result.output


def test_run_fails_without_config(tmp_path):
    runner = CliRunner()
    with runner.isolated_filesystem(temp_dir=tmp_path):
        result = runner.invoke(main, ["run"])
        assert result.exit_code != 0
