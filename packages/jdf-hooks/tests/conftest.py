"""Shared fixtures: keep the test suite off the network."""

import pytest

from jdf_hooks import pypi


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch):
    """`jdf-hooks check` looks up PyPI for a newer version; tests must never hit the network."""

    def refuse(*args, **kwargs):
        raise OSError("network disabled in tests")

    monkeypatch.setattr(pypi.urllib.request, "urlopen", refuse)
