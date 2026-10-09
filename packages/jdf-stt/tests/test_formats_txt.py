import pytest

from jdf_stt import formats
from jdf_stt.types import Segment, SttError, Transcript

T = Transcript(" Hello there. ", (Segment(0, 1, " Hello there. "),), "en", "fake", "m")


def test_txt_is_the_stripped_text_with_a_newline():
    assert formats.render(T, "txt") == "Hello there.\n"


def test_txt_of_silence_is_empty():
    assert formats.render(Transcript("", (), None, "fake", "m"), "txt") == ""


def test_unknown_format():
    with pytest.raises(SttError, match="unknown format 'docx'"):
        formats.render(T, "docx")


def test_write_outputs_keeps_dots_in_the_name(tmp_path):
    paths = formats.write_outputs(T, tmp_path / "out" / "talk.2026-10-05", ["txt"])
    assert paths == [tmp_path / "out" / "talk.2026-10-05.txt"]
    assert paths[0].read_text(encoding="utf-8") == "Hello there.\n"
