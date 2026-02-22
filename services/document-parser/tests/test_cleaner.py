from app.utils.cleaner import TextCleaner

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