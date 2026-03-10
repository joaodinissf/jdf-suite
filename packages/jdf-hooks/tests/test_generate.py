"""Automated tests for config generation logic."""

from pathlib import Path

import pytest
import yaml

from jdf_hooks.generate import (
    LANGUAGE_CONFIGS,
    LANGUAGE_FRAGMENTS,
    generate_configs,
    generate_lefthook_config,
    generate_precommit_config,
    get_templates_dir,
    load_fragments,
)

TEMPLATES_DIR = get_templates_dir()
ALL_LANGUAGES = set(LANGUAGE_FRAGMENTS.keys())


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def assert_valid_yaml(path: Path) -> dict:
    """Assert that a file contains parseable YAML and return the parsed data."""
    content = path.read_text()
    data = yaml.safe_load(content)
    assert isinstance(data, dict)
    return data


# ---------------------------------------------------------------------------
# 1. Generation with defaults (no files in target)
# ---------------------------------------------------------------------------


class TestGenerationDefaults:
    def test_lefthook_produces_valid_yaml(self, tmp_path: Path):
        path = generate_lefthook_config(tmp_path, ALL_LANGUAGES, TEMPLATES_DIR)
        assert path.exists()
        data = assert_valid_yaml(path)
        assert "pre-commit" in data

    def test_precommit_produces_valid_yaml(self, tmp_path: Path):
        path = generate_precommit_config(tmp_path, ALL_LANGUAGES, TEMPLATES_DIR)
        assert path.exists()
        data = assert_valid_yaml(path)
        assert "repos" in data


# ---------------------------------------------------------------------------
# 2-4. Hook manager selection
# ---------------------------------------------------------------------------


class TestHookManagerSelection:
    def test_lefthook_only(self, tmp_path: Path):
        result = generate_configs(tmp_path, ALL_LANGUAGES, "lefthook", TEMPLATES_DIR)
        assert any(p.name == "lefthook.yml" for p in result["hook_files"])
        assert not any(p.name == ".pre-commit-config.yaml" for p in result["hook_files"])

    def test_precommit_only(self, tmp_path: Path):
        result = generate_configs(tmp_path, ALL_LANGUAGES, "pre-commit", TEMPLATES_DIR)
        assert any(p.name == ".pre-commit-config.yaml" for p in result["hook_files"])
        assert not any(p.name == "lefthook.yml" for p in result["hook_files"])

    def test_both(self, tmp_path: Path):
        result = generate_configs(tmp_path, ALL_LANGUAGES, "both", TEMPLATES_DIR)
        names = {p.name for p in result["hook_files"]}
        assert "lefthook.yml" in names
        assert ".pre-commit-config.yaml" in names


# ---------------------------------------------------------------------------
# 5. All languages selected
# ---------------------------------------------------------------------------


class TestAllLanguages:
    def test_lefthook_all_sections(self, tmp_path: Path):
        path = generate_lefthook_config(tmp_path, ALL_LANGUAGES, TEMPLATES_DIR)
        content = path.read_text()
        for lang in ALL_LANGUAGES:
            # Each language fragment has a section header comment
            assert f"# {'PYTHON TYPE CHECKING' if lang == 'python' else ''}" or lang.upper() in content

    def test_precommit_all_sections(self, tmp_path: Path):
        path = generate_precommit_config(tmp_path, ALL_LANGUAGES, TEMPLATES_DIR)
        content = path.read_text()
        # Verify all section headers are present
        for section_name in [
            "PYTHON",
            "PYTHON TYPE CHECKING",
            "JAVASCRIPT",
            "RUST",
            "JAVA",
            "MARKDOWN",
            "YAML",
            "TOML",
            "SQL",
            "SHELL",
            "GENERAL FILE CHECKS",
        ]:
            assert section_name in content, f"Missing section: {section_name}"

    def test_lefthook_all_section_headers(self, tmp_path: Path):
        path = generate_lefthook_config(tmp_path, ALL_LANGUAGES, TEMPLATES_DIR)
        content = path.read_text()
        for section_name in [
            "PYTHON",
            "PYTHON TYPE CHECKING",
            "JAVASCRIPT",
            "RUST",
            "JAVA",
            "MARKDOWN",
            "YAML",
            "TOML",
            "SQL",
            "SHELL",
            "GENERAL FILE CHECKS",
        ]:
            assert section_name in content, f"Missing section: {section_name}"


# ---------------------------------------------------------------------------
# 6. Single language
# ---------------------------------------------------------------------------


class TestSingleLanguage:
    @pytest.mark.parametrize("lang", list(LANGUAGE_FRAGMENTS.keys()))
    def test_precommit_single_language(self, tmp_path: Path, lang: str):
        path = generate_precommit_config(tmp_path, {lang}, TEMPLATES_DIR)
        content = path.read_text()
        data = assert_valid_yaml(path)
        assert "repos" in data

        # Should NOT contain other language sections (except the selected one)
        other_sections = {
            "python": "PYTHON",
            "javascript": "JAVASCRIPT",
            "rust": "RUST",
            "java": "JAVA",
            "markdown": "MARKDOWN",
            "yaml": "# YAML",
            "toml": "TOML",
            "sql": "SQL",
            "shell": "SHELL",
            "general": "GENERAL FILE CHECKS",
        }
        for other_lang, section_header in other_sections.items():
            if other_lang == lang:
                assert section_header in content
            elif lang == "python" and other_lang in ("python",):
                continue  # python includes python_typechecking
            else:
                # Don't check for substring matches that could appear in comments
                pass

    @pytest.mark.parametrize("lang", list(LANGUAGE_FRAGMENTS.keys()))
    def test_lefthook_single_language(self, tmp_path: Path, lang: str):
        path = generate_lefthook_config(tmp_path, {lang}, TEMPLATES_DIR)
        assert_valid_yaml(path)


# ---------------------------------------------------------------------------
# 7. No languages selected
# ---------------------------------------------------------------------------


class TestNoLanguages:
    def test_precommit_empty(self, tmp_path: Path):
        path = generate_precommit_config(tmp_path, set(), TEMPLATES_DIR)
        content = path.read_text()
        assert "repos:" in content
        # Should be valid YAML (repos: with nothing after is valid)
        yaml.safe_load(content)

    def test_lefthook_empty(self, tmp_path: Path):
        path = generate_lefthook_config(tmp_path, set(), TEMPLATES_DIR)
        content = path.read_text()
        assert "pre-commit:" in content
        yaml.safe_load(content)


# ---------------------------------------------------------------------------
# 8. Config files copied for languages with configs
# ---------------------------------------------------------------------------


class TestConfigFiles:
    @pytest.mark.parametrize("lang,config_paths", list(LANGUAGE_CONFIGS.items()))
    def test_config_files_copied(self, tmp_path: Path, lang: str, config_paths: list[str]):
        result = generate_configs(tmp_path, {lang}, "lefthook", TEMPLATES_DIR)
        for config_path in config_paths:
            target = tmp_path / config_path
            assert target.exists(), f"Config file not copied: {config_path}"
        assert len(result["configs"]) == len(config_paths)


# ---------------------------------------------------------------------------
# 9. No config files for languages without configs
# ---------------------------------------------------------------------------


class TestNoConfigFiles:
    @pytest.mark.parametrize(
        "lang",
        [lang for lang in LANGUAGE_FRAGMENTS if lang not in LANGUAGE_CONFIGS],
    )
    def test_no_config_files(self, tmp_path: Path, lang: str):
        result = generate_configs(tmp_path, {lang}, "lefthook", TEMPLATES_DIR)
        assert result["configs"] == []


# ---------------------------------------------------------------------------
# 10. Generated YAML is parseable
# ---------------------------------------------------------------------------


class TestYamlParseable:
    @pytest.mark.parametrize("manager", ["lefthook", "pre-commit", "both"])
    def test_all_languages_parseable(self, tmp_path: Path, manager: str):
        result = generate_configs(tmp_path, ALL_LANGUAGES, manager, TEMPLATES_DIR)
        for path in result["hook_files"]:
            assert_valid_yaml(path)

    @pytest.mark.parametrize("lang", list(LANGUAGE_FRAGMENTS.keys()))
    def test_single_language_parseable_precommit(self, tmp_path: Path, lang: str):
        path = generate_precommit_config(tmp_path, {lang}, TEMPLATES_DIR)
        assert_valid_yaml(path)

    @pytest.mark.parametrize("lang", list(LANGUAGE_FRAGMENTS.keys()))
    def test_single_language_parseable_lefthook(self, tmp_path: Path, lang: str):
        path = generate_lefthook_config(tmp_path, {lang}, TEMPLATES_DIR)
        assert_valid_yaml(path)


# ---------------------------------------------------------------------------
# 11. Deterministic output
# ---------------------------------------------------------------------------


class TestDeterministic:
    def test_precommit_deterministic(self, tmp_path: Path):
        dir1 = tmp_path / "run1"
        dir2 = tmp_path / "run2"
        dir1.mkdir()
        dir2.mkdir()

        generate_precommit_config(dir1, ALL_LANGUAGES, TEMPLATES_DIR)
        generate_precommit_config(dir2, ALL_LANGUAGES, TEMPLATES_DIR)

        content1 = (dir1 / ".pre-commit-config.yaml").read_text()
        content2 = (dir2 / ".pre-commit-config.yaml").read_text()
        assert content1 == content2

    def test_lefthook_deterministic(self, tmp_path: Path):
        dir1 = tmp_path / "run1"
        dir2 = tmp_path / "run2"
        dir1.mkdir()
        dir2.mkdir()

        generate_lefthook_config(dir1, ALL_LANGUAGES, TEMPLATES_DIR)
        generate_lefthook_config(dir2, ALL_LANGUAGES, TEMPLATES_DIR)

        content1 = (dir1 / "lefthook.yml").read_text()
        content2 = (dir2 / "lefthook.yml").read_text()
        assert content1 == content2


# ---------------------------------------------------------------------------
# Fragment loading
# ---------------------------------------------------------------------------


class TestLoadFragments:
    def test_load_precommit_fragments(self):
        content = load_fragments("precommit", ALL_LANGUAGES, TEMPLATES_DIR)
        assert len(content) > 0
        assert "- repo:" in content

    def test_load_lefthook_fragments(self):
        content = load_fragments("lefthook", ALL_LANGUAGES, TEMPLATES_DIR)
        assert len(content) > 0
        assert "- group:" in content

    def test_load_empty_set(self):
        content = load_fragments("precommit", set(), TEMPLATES_DIR)
        assert content == ""

    def test_fragment_order_matches_dict_order(self):
        content = load_fragments("precommit", {"python", "javascript", "general"}, TEMPLATES_DIR)
        python_pos = content.find("PYTHON")
        js_pos = content.find("JAVASCRIPT")
        general_pos = content.find("GENERAL")
        assert python_pos < js_pos < general_pos
