"""Language detection for projects."""

from pathlib import Path

# Language detection configuration
# Each language has file extensions and/or config files that indicate its presence
LANGUAGE_DETECTORS: dict[str, dict[str, list[str]]] = {
    "python": {
        "extensions": [".py", ".pyi"],
        "files": [
            "pyproject.toml",
            "setup.py",
            "setup.cfg",
            "requirements.txt",
            "Pipfile",
        ],
    },
    "javascript": {
        "extensions": [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"],
        "files": ["package.json", "tsconfig.json", ".eslintrc.js", ".eslintrc.json"],
    },
    "rust": {
        "extensions": [".rs"],
        "files": ["Cargo.toml"],
    },
    "java": {
        "extensions": [".java"],
        "files": ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle"],
    },
    "markdown": {
        "extensions": [".md", ".markdown"],
    },
    "yaml": {
        "extensions": [".yml", ".yaml"],
    },
    "toml": {
        "extensions": [".toml"],
    },
    "sql": {
        "extensions": [".sql"],
    },
    "shell": {
        "extensions": [".sh", ".bash", ".zsh"],
    },
}

# Display names for languages
LANGUAGE_NAMES: dict[str, str] = {
    "python": "Python",
    "javascript": "JavaScript/TypeScript",
    "rust": "Rust",
    "java": "Java",
    "markdown": "Markdown",
    "yaml": "YAML",
    "toml": "TOML",
    "sql": "SQL",
    "shell": "Shell scripts",
}

# Maximum depth to scan for files
MAX_SCAN_DEPTH = 3

# Directories to skip when scanning
SKIP_DIRS = {
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    ".env",
    "env",
    "target",
    "build",
    "dist",
    ".mypy_cache",
    ".ruff_cache",
    ".pytest_cache",
    ".tox",
    "vendor",
}


def detect_languages(directory: Path) -> dict[str, list[str]]:
    """Detect languages used in a project directory.

    Args:
        directory: The project root directory to scan.

    Returns:
        A dictionary mapping language names to lists of reasons why
        they were detected (e.g., file names or counts).
    """
    detected: dict[str, list[str]] = {}
    file_counts: dict[str, int] = dict.fromkeys(LANGUAGE_DETECTORS, 0)

    directory = directory.resolve()

    # Scan for config files at root level
    for language, config in LANGUAGE_DETECTORS.items():
        for config_file in config.get("files", []):
            if (directory / config_file).exists():
                if language not in detected:
                    detected[language] = []
                detected[language].append(config_file)

    # Scan for files with matching extensions (limited depth)
    def scan_dir(path: Path, depth: int = 0) -> None:
        if depth > MAX_SCAN_DEPTH:
            return

        try:
            for item in path.iterdir():
                if item.is_dir():
                    if item.name not in SKIP_DIRS and not item.name.startswith("."):
                        scan_dir(item, depth + 1)
                elif item.is_file():
                    suffix = item.suffix.lower()
                    for language, config in LANGUAGE_DETECTORS.items():
                        if suffix in config.get("extensions", []):
                            file_counts[language] += 1
        except PermissionError:
            pass

    scan_dir(directory)

    # Add file count reasons
    for language, count in file_counts.items():
        if count > 0:
            if language not in detected:
                detected[language] = []
            detected[language].append(f"{count} {LANGUAGE_DETECTORS[language]['extensions'][0]} files")

    return detected


def get_language_display(language: str) -> str:
    """Get the display name for a language."""
    return LANGUAGE_NAMES.get(language, language.title())
