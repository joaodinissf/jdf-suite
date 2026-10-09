"""Output and language options: --format, --language, --expected-language."""

from __future__ import annotations

import argparse

from jdf_stt import formats, language, registry
from jdf_stt.types import SttError


def _language(value: str) -> str:
    try:
        return language.normalise(value)
    except SttError as e:
        raise argparse.ArgumentTypeError(str(e)) from None


def _languages(value: str) -> list[str]:
    return [_language(part) for part in value.split(",") if part.strip()]


class _Extend(argparse.Action):
    """Collect values from every use of the flag, in order, without duplicates."""

    def __call__(self, parser, namespace, values, option_string=None):
        current = list(getattr(namespace, self.dest) or [])
        for value in values if isinstance(values, list) else [values]:
            if value not in current:
                current.append(value)
        setattr(namespace, self.dest, current)


@registry.transcribe_options
def add(group: argparse._ArgumentGroup) -> None:
    group.add_argument(
        "-f",
        "--format",
        dest="formats",
        action=_Extend,
        choices=formats.FORMATS,
        default=None,
        metavar="FORMAT",
        help=f"output format, repeat for several: {', '.join(formats.FORMATS)} (default txt)",
    )
    group.add_argument(
        "-l",
        "--language",
        dest="language",
        type=_language,
        default=None,
        metavar="LANG",
        help="spoken language, e.g. en or pt; auto detects it (default auto)",
    )
    group.add_argument(
        "--expected-language",
        dest="expected_languages",
        action=_Extend,
        type=_languages,
        default=None,
        metavar="LANG[,LANG]",
        help="languages you speak; a detection outside them is redone in the first one (repeat or comma-separate)",
    )
