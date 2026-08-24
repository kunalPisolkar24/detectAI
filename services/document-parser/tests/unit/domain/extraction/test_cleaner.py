from app.domain.extraction.cleaner import TextCleaner

def test_clean_empty_string():
    result = TextCleaner.clean("")
    assert result == ""

def test_clean_none():
    result = TextCleaner.clean(None)
    assert result == ""

def test_normalize_line_endings():
    input_text = "Line 1\r\nLine 2\rLine 3"
    expected = "Line 1\nLine 2\nLine 3"
    assert TextCleaner.clean(input_text) == expected

def test_remove_artifacts():
    input_text = "Hello\xa0World\x0c"
    expected = "Hello World"
    assert TextCleaner.clean(input_text) == expected

def test_remove_page_numbers():
    input_text = "Text start.\nPage 1 of 10\nText end."
    expected = "Text start.\nText end."
    assert TextCleaner.clean(input_text) == expected

def test_collapse_whitespace():
    input_text = "Word1    Word2"
    expected = "Word1 Word2"
    assert TextCleaner.clean(input_text) == expected

def test_collapse_excessive_newlines():
    input_text = "Para 1\n\n\n\nPara 2"
    expected = "Para 1\n\nPara 2"
    assert TextCleaner.clean(input_text) == expected

def test_trim_lines():
    input_text = "  Line 1  \n  Line 2  "
    expected = "Line 1\nLine 2"
    assert TextCleaner.clean(input_text) == expected

def test_strip_zero_width_and_control_chars():
    input_text = "A\u200bB\u200cC\u200dD\u2060E\ufeffF\x07G\tH"
    assert TextCleaner.clean(input_text) == "ABCDEFG H"

def test_newlines_survive_while_controls_removed():
    input_text = "line one\x01\nline two\x02"
    result = TextCleaner.clean(input_text)
    assert result == "line one\nline two"
    assert "\x01" not in result

def test_repairs_hyphenated_line_breaks():
    input_text = "docu-\nment shipped on time"
    assert TextCleaner.clean(input_text) == "document shipped on time"

def test_keeps_hyphens_without_line_break():
    input_text = "a well-known fact"
    assert TextCleaner.clean(input_text) == "a well-known fact"