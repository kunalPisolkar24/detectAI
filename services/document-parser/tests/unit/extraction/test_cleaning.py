"""The phase-2 normalizer's ordered rules, one anchor per decision."""

from app.extraction.cleaning import normalize


def test_line_endings_normalize_to_lf() -> None:
    # Rule 1: CRLF, CR, and the unicode line/paragraph separators — even
    # inside a single carried line — all become the one newline.
    assert normalize(["a\r\nb", "c\rd", "x\u2028y", "p\u2029q"]) == "a\nb\nc\nd\nx\ny\np\nq"


def test_control_and_invisible_characters_are_dropped() -> None:
    # Rule 2: the control ranges, zero-widths, the BOM, and the soft
    # hyphen vanish; CR is a line ending rule 2 never sees, the newline
    # survives, and nothing else does.
    assert normalize(["a\x00bc\x07d", "e\x7ff\x9fg\x85h"]) == "abcd\nefgh"
    assert normalize(["zero\u200bwidth\u200c\u200d\u2060gone"]) == "zerowidthgone"
    assert normalize(["\ufeffsoft\u00adhyphen"]) == "softhyphen"


def test_tabs_are_whitespace_not_deleted() -> None:
    assert normalize(["a\tb"]) == "a b"


def test_nbsp_becomes_a_space() -> None:
    assert normalize(["a\u00a0b"]) == "a b"


def test_hyphenated_breaks_rejoin_word_halves_only() -> None:
    # Rule 4: a hyphen joins two word halves across the break; a space
    # after the break defeats the join and the pair stays two lines. The
    # compound merge is the trade-off cleaning.md records.
    assert normalize(["docu-", "ment"]) == "document"
    assert normalize(["docu-", " ment"]) == "docu-\nment"
    assert normalize(["well-", "known"]) == "wellknown"


def test_page_artifacts_die_only_as_whole_lines() -> None:
    # Rule 5: the two folio shapes as whole trimmed lines; anything with
    # other content keeps its mid-sentence reference, a missing trailing
    # dash is not folio-shaped, and case does not save the artifact.
    assert normalize(["Page 2 of 4", "body"]) == "body"
    assert normalize(["page 3 of 5", "  - 12 -  ", "text"]) == "text"
    assert normalize(["-12", "text"]) == "-12\ntext"
    assert normalize(["see Page 3 of 10 in the appendix"]) == "see Page 3 of 10 in the appendix"


def test_a_bare_number_line_is_not_folio_shaped() -> None:
    # No bare-number suppression outside rule (b) (cleaning.md).
    assert normalize(["12", "text"]) == "12\ntext"


def test_whitespace_collapses_and_blank_runs_become_paragraph_breaks() -> None:
    # Rule 6: space/tab runs fold to one space, line edges trim, and 3+
    # newlines become exactly two.
    assert normalize(["  spaced \t out  "]) == "spaced out"
    assert normalize(["a", "", "", "b"]) == "a\n\nb"


def test_ends_trim() -> None:
    # Rule 7 after the per-line trim of rule 6: the document's own ends go.
    assert normalize(["", "first", "", "last", ""]) == "first\n\nlast"


def test_repeated_lines_are_never_deduped() -> None:
    # The fidelity promise: repetition below the phase-1 thresholds stays.
    assert normalize(["same", "same"]) == "same\nsame"


def test_an_empty_body_normalizes_to_the_empty_string() -> None:
    assert normalize([]) == ""
    assert normalize([""]) == ""
