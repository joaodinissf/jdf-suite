"""Tests for the .jdf-hooks.lock file."""

import json
from pathlib import Path

import pytest

from jdf_hooks.lock import LOCK_FILENAME, LockError, LockFile, hash_bytes, read_lock, write_lock

SAMPLE = LockFile(
    jdf_hooks="1.2.0",
    manager="both",
    languages=["python", "general"],
    files={"lefthook.yml": "sha256:aa", ".pre-commit-config.yaml": "sha256:bb"},
)


def test_round_trip(tmp_path: Path):
    path = write_lock(tmp_path, SAMPLE)
    assert path == tmp_path / LOCK_FILENAME
    loaded = read_lock(tmp_path)
    assert loaded is not None
    assert loaded.jdf_hooks == "1.2.0"
    assert loaded.manager == "both"
    assert loaded.languages == ["general", "python"]  # sorted on both write and read
    assert loaded.files == SAMPLE.files


def test_json_is_sorted_and_deterministic():
    text = SAMPLE.to_json()
    data = json.loads(text)
    assert list(data["files"]) == sorted(data["files"])
    assert data["languages"] == ["general", "python"]
    assert text.endswith("\n")
    assert SAMPLE.to_json() == text


def test_missing_lock_is_none(tmp_path: Path):
    assert read_lock(tmp_path) is None


MALFORMED = ["not json", "{}", '{"jdf_hooks": "1", "manager": "both", "languages": 5, "files": {}}', "[]"]


@pytest.mark.parametrize("text", MALFORMED)
def test_malformed_lock_raises(tmp_path: Path, text: str):
    (tmp_path / LOCK_FILENAME).write_text(text)
    with pytest.raises(LockError):
        read_lock(tmp_path)


def test_hash_bytes_format():
    digest = hash_bytes(b"hello")
    assert digest.startswith("sha256:")
    assert len(digest) == len("sha256:") + 64
    assert digest == hash_bytes(b"hello")
    assert digest != hash_bytes(b"hello!")
