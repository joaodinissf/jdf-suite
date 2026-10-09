import subprocess
import sys
import tomllib
from pathlib import Path

import pytest

import jdf_stt
from jdf_stt import registry
from jdf_stt.types import Cancelled, SttError

PYPROJECT = Path(__file__).parents[1] / "pyproject.toml"
VERSION = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))["project"]["version"]


def test_version_matches_pyproject(cli):
    assert jdf_stt.__version__ == VERSION
    result = cli("--version")
    assert (result.code, result.out) == (0, f"jdf-stt {VERSION}\n")


def test_help_lists_transcribe(cli):
    result = cli("--help")
    assert result.code == 0
    assert "transcribe" in result.out
    assert "Nothing leaves your Mac" in result.out


def test_no_arguments_prints_help(cli):
    result = cli()
    assert result.code == 0 and "usage: jdf-stt" in result.out


def test_transcribe_help_has_the_shared_option_group(cli):
    result = cli("transcribe", "--help")
    assert result.code == 0 and "FILE" in result.out


@pytest.fixture
def spy(clean_registry):
    """Replace `transcribe` with a spy and add an `other` command."""
    seen = {}

    @registry.command("transcribe", help="spy")
    def setup(parser):
        parser.add_argument("inputs", nargs="*")
        parser.add_argument("--mic", action="store_true", default=None)

        def run(ns):
            seen["transcribe"] = ns
            return 0

        return run

    @registry.command("other", help="another command")
    def setup_other(parser):
        def run(ns):
            seen["other"] = ns
            return 7

        return run

    return seen


def test_a_file_runs_transcribe(cli, spy):
    assert cli("a.wav", "b.m4a").code == 0
    assert spy["transcribe"].inputs == ["a.wav", "b.m4a"]


def test_an_option_first_runs_transcribe(cli, spy):
    assert cli("--mic").code == 0
    assert spy["transcribe"].mic is True


def test_a_registered_command_runs_itself(cli, spy):
    assert cli("other").code == 7
    assert "transcribe" not in spy


def test_explicit_transcribe_takes_a_file_named_like_a_command(cli, spy):
    assert cli("transcribe", "other").code == 0
    assert spy["transcribe"].inputs == ["other"]


@pytest.mark.parametrize(
    ("error", "code", "message"),
    [
        (SttError("whisper-cli not found. Install: brew install whisper-cpp"), 1, "jdf-stt: whisper-cli not found"),
        (Cancelled(), 130, "jdf-stt: cancelled"),
        (Cancelled("recording cancelled"), 130, "jdf-stt: recording cancelled"),
        (KeyboardInterrupt(), 130, "jdf-stt: cancelled"),
    ],
)
def test_errors_become_exit_codes(cli, clean_registry, error, code, message):
    @registry.command("boom", help="fails")
    def setup(parser):
        def run(ns):
            raise error

        return run

    result = cli("boom")
    assert result.code == code
    assert result.err.startswith(message)
    assert "Traceback" not in result.err


def test_a_new_feature_file_appears_without_editing_cli(cli, clean_registry, add_module):
    add_module(
        "jdf_stt.features",
        "zz_hello",
        """
from jdf_stt import registry


@registry.command("hello", help="Say hello (test feature).")
def setup(parser):
    parser.add_argument("--name", default="world")

    def run(ns):
        print(f"hello {ns.name}")
        return 0

    return run
""",
    )
    assert "Say hello (test feature)." in cli("--help").out
    assert cli("hello", "--name", "Mac").out == "hello Mac\n"


def test_python_dash_m_and_the_console_script():
    for cmd in (
        [sys.executable, "-m", "jdf_stt", "--version"],
        [str(Path(sys.executable).parent / "jdf-stt"), "--version"],
    ):
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        assert (proc.returncode, proc.stdout) == (0, f"jdf-stt {VERSION}\n"), cmd
