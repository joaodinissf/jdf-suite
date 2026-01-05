"""Config file generation from templates."""

import re
import shutil
from pathlib import Path

# Mapping from our language names to section headers in config files
LANGUAGE_SECTIONS: dict[str, list[str]] = {
    "python": ["PYTHON", "PYTHON TYPE CHECKING"],
    "javascript": ["JAVASCRIPT/TYPESCRIPT/WEB"],
    "rust": ["RUST"],
    "java": ["JAVA"],
    "markdown": ["MARKDOWN"],
    "yaml": ["YAML"],
    "toml": ["TOML"],
    "sql": ["SQL"],
    "shell": ["SHELL SCRIPTS"],
    "general": ["GENERAL FILE CHECKS"],
}

# Config files needed for each language
LANGUAGE_CONFIGS: dict[str, list[str]] = {
    "markdown": ["configs/markdown/markdownlint.json"],
    "yaml": ["configs/yaml/yamlfix.toml"],
    "toml": ["configs/toml/taplo.toml"],
    "sql": ["configs/sql/.sqlfluff"],
}


def get_repo_root() -> Path:
    """Find the repository root directory.

    This works both when running from source and when installed as a package.
    """
    # First, try to find from the module location
    module_dir = Path(__file__).parent

    # Check if we're in src/sensible_hooks (source layout)
    if (module_dir.parent.parent / ".pre-commit-config.yaml").exists():
        return module_dir.parent.parent

    # Check if we're installed and have package data
    # Package data would be at sensible_hooks/configs, etc.
    if (module_dir / "configs").exists():
        return module_dir

    # Fallback: try current working directory
    cwd = Path.cwd()
    if (cwd / ".pre-commit-config.yaml").exists():
        return cwd

    raise FileNotFoundError(
        "Could not find sensible-hooks repository. "
        "Make sure you're running from the repo directory or have "
        "installed the package."
    )


def extract_sections(content: str, languages: set[str]) -> str:
    """Extract sections from config file based on selected languages.

    Args:
        content: The full config file content.
        languages: Set of language names to include.

    Returns:
        Filtered config file content.
    """
    # Build set of section headers to include
    headers_to_include: set[str] = set()
    for lang in languages:
        headers_to_include.update(LANGUAGE_SECTIONS.get(lang, []))

    # Always include general checks if selected
    if "general" in languages:
        headers_to_include.update(LANGUAGE_SECTIONS["general"])

    lines = content.split("\n")
    result_lines: list[str] = []
    current_section: str | None = None
    include_section = True
    header_lines: list[str] = []

    # Pattern for section headers
    section_pattern = re.compile(r"^#\s*([A-Z][A-Z0-9/\s]+)\s*$")
    separator_pattern = re.compile(r"^#\s*=+\s*$")

    i = 0
    while i < len(lines):
        line = lines[i]

        # Check if this is a separator line (start of header block)
        if separator_pattern.match(line):
            # Look ahead to find the section name
            header_lines = [line]
            j = i + 1

            while j < len(lines):
                next_line = lines[j]
                header_lines.append(next_line)

                # Check for section name
                match = section_pattern.match(next_line)
                if match:
                    current_section = match.group(1).strip()
                    # Continue to get the closing separator
                    j += 1
                    while j < len(lines) and not separator_pattern.match(lines[j]):
                        header_lines.append(lines[j])
                        j += 1
                    if j < len(lines):
                        header_lines.append(lines[j])
                    break

                if separator_pattern.match(next_line):
                    break
                j += 1

            # Determine if we should include this section
            if current_section:
                include_section = current_section in headers_to_include

            if include_section:
                result_lines.extend(header_lines)

            i = j + 1
            continue

        # Regular content line
        if include_section:
            result_lines.append(line)
        i += 1

    return "\n".join(result_lines)


def generate_precommit_config(
    target_dir: Path,
    languages: set[str],
    repo_root: Path | None = None,
) -> Path:
    """Generate .pre-commit-config.yaml for the target project.

    Args:
        target_dir: Directory to write the config file to.
        languages: Set of languages to include hooks for.
        repo_root: Optional repo root (auto-detected if not provided).

    Returns:
        Path to the generated config file.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    source_config = repo_root / ".pre-commit-config.yaml"
    content = source_config.read_text()

    # Update the header comment
    header = """# ============================================================================
# PRE-COMMIT HOOKS CONFIGURATION
# ============================================================================
# Generated by sensible-hooks (https://github.com/joaodinissf/Sensible-Pre-Commit-Hooks)
#
# Run: pre-commit install
# Test: pre-commit run --all-files
# ============================================================================
repos:
"""

    # Extract sections for selected languages
    # Remove the original header and repos: line
    content_start = content.find("repos:")
    if content_start != -1:
        content = content[content_start + 6 :]  # Skip "repos:" line

    filtered_content = extract_sections(content, languages)

    # Combine header with filtered content
    output = header + filtered_content

    # Write to target
    target_path = target_dir / ".pre-commit-config.yaml"
    target_path.write_text(output)

    return target_path


def generate_lefthook_config(
    target_dir: Path,
    languages: set[str],
    repo_root: Path | None = None,
) -> Path:
    """Generate lefthook.yml for the target project.

    Args:
        target_dir: Directory to write the config file to.
        languages: Set of languages to include hooks for.
        repo_root: Optional repo root (auto-detected if not provided).

    Returns:
        Path to the generated config file.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    source_config = repo_root / "lefthook.yml"
    content = source_config.read_text()

    # Update the header comment
    header = """# ============================================================================
# LEFTHOOK CONFIGURATION
# ============================================================================
# Generated by sensible-hooks (https://github.com/joaodinissf/Sensible-Pre-Commit-Hooks)
#
# Run: lefthook install
# Test: lefthook run pre-commit --all-files
# ============================================================================
"""

    # Extract sections for selected languages
    filtered_content = extract_sections(content, languages)

    # Find where the actual config starts (after original header)
    config_start = filtered_content.find("pre-commit:")
    if config_start != -1:
        filtered_content = filtered_content[config_start:]

    output = header + filtered_content

    # Write to target
    target_path = target_dir / "lefthook.yml"
    target_path.write_text(output)

    return target_path


def copy_config_files(
    target_dir: Path,
    languages: set[str],
    repo_root: Path | None = None,
) -> list[Path]:
    """Copy necessary config files for selected languages.

    Args:
        target_dir: Directory to copy config files to.
        languages: Set of languages that need config files.
        repo_root: Optional repo root (auto-detected if not provided).

    Returns:
        List of paths to copied config files.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    copied_files: list[Path] = []

    for lang in languages:
        for config_path in LANGUAGE_CONFIGS.get(lang, []):
            source = repo_root / config_path
            if source.exists():
                # Create target directory structure
                target = target_dir / config_path
                target.parent.mkdir(parents=True, exist_ok=True)

                # Copy the file
                shutil.copy2(source, target)
                copied_files.append(target)

    return copied_files


def generate_configs(
    target_dir: Path,
    languages: set[str],
    hook_manager: str,
    repo_root: Path | None = None,
) -> dict[str, list[Path]]:
    """Generate all necessary config files for the target project.

    Args:
        target_dir: Directory to write config files to.
        languages: Set of languages to include.
        hook_manager: One of "lefthook", "pre-commit", or "both".
        repo_root: Optional repo root (auto-detected if not provided).

    Returns:
        Dictionary with "configs" and "hook_files" keys listing created files.
    """
    if repo_root is None:
        repo_root = get_repo_root()

    result: dict[str, list[Path]] = {"hook_files": [], "configs": []}

    # Generate hook manager config(s)
    if hook_manager in ("lefthook", "both"):
        path = generate_lefthook_config(target_dir, languages, repo_root)
        result["hook_files"].append(path)

    if hook_manager in ("pre-commit", "both"):
        path = generate_precommit_config(target_dir, languages, repo_root)
        result["hook_files"].append(path)

    # Copy language-specific config files
    result["configs"] = copy_config_files(target_dir, languages, repo_root)

    return result
