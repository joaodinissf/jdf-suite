"""The external tools each language's hooks invoke, with install hints.

Single source of truth for `jdf-hooks doctor`, the post-setup hints, and the
integration tests.
"""

import shutil
from dataclasses import dataclass


@dataclass(frozen=True)
class Tool:
    name: str
    install: str
    binary: str | None = None  # defaults to name

    @property
    def executable(self) -> str:
        return self.binary or self.name

    def is_installed(self) -> bool:
        return shutil.which(self.executable) is not None


TOOLS_BY_LANGUAGE: dict[str, list[Tool]] = {
    "python": [
        Tool("pycln", "uv tool install pycln"),
        Tool("isort", "uv tool install isort"),
        Tool("ruff", "uv tool install ruff"),
        Tool("ty", "uv tool install ty"),
    ],
    "javascript": [Tool("prettier", "npm install -g prettier")],
    "rust": [
        Tool("rustfmt", "rustup component add rustfmt"),
        Tool("cargo", "rustup component add clippy  # clippy runs through cargo"),
    ],
    "java": [
        Tool("pmd", "brew install pmd"),
        Tool("checkstyle", "brew install checkstyle"),
    ],
    "markdown": [Tool("markdownlint", "npm install -g markdownlint-cli")],
    "yaml": [Tool("yamlfix", "uv tool install yamlfix")],
    "toml": [Tool("taplo", "cargo install taplo-cli")],
    "sql": [Tool("sqlfluff", "uv tool install sqlfluff")],
    "shell": [Tool("shfmt", "brew install shfmt")],
    "general": [
        Tool("keep-sorted", "go install github.com/google/keep-sorted@latest"),
        Tool("uvx", "https://docs.astral.sh/uv/  # runs the pre-commit-hooks checks", binary="uvx"),
    ],
}

MANAGER_TOOLS: dict[str, Tool] = {
    "lefthook": Tool("lefthook", "brew install lefthook  # or: npm install -g lefthook"),
    "pre-commit": Tool("pre-commit", "uv tool install pre-commit"),
}


def required_tools(languages: set[str], manager: str) -> list[Tool]:
    """Tools needed for the given hook set, managers first, deduplicated, in table order."""
    tools: list[Tool] = [t for name, t in MANAGER_TOOLS.items() if manager in (name, "both")]
    for lang, lang_tools in TOOLS_BY_LANGUAGE.items():
        if lang in languages:
            tools.extend(t for t in lang_tools if t not in tools)
    return tools


def missing_tools(languages: set[str], manager: str) -> list[Tool]:
    return [t for t in required_tools(languages, manager) if not t.is_installed()]
