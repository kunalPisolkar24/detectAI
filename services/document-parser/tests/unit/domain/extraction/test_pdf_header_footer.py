import fitz

from app.domain.extraction.strategies import PdfExtractionStrategy

PAGE_WIDTH = 612
PAGE_HEIGHT = 792
HEADER_Y = 25
FOOTER_Y = 770
MIDDLE_Y = 500
LINE_SPACING = 40


def _write_pdf(path, pages):
    with fitz.open() as doc:
        for lines in pages:
            page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
            for y, text in lines:
                page.insert_text((72, y), text, fontname="helv", fontsize=11)
        doc.save(path)


def test_pdf_extraction_strips_margin_band(tmp_path):
    pdf = tmp_path / "letter.pdf"
    _write_pdf(pdf, [
        [
            (HEADER_Y, "HEADER CANARY"),
            (MIDDLE_Y, "Body line"),
            (FOOTER_Y, "Page 1"),
        ]
    ])

    result = PdfExtractionStrategy().extract(str(pdf))

    assert "HEADER CANARY" not in result.text
    assert "Page 1" not in result.text
    assert "Body line" in result.text


def test_pdf_extraction_keeps_body_text_touching_margin_band(tmp_path):
    pdf = tmp_path / "letter.pdf"
    _write_pdf(pdf, [[(HEADER_Y + LINE_SPACING, "Heading near top")]])

    result = PdfExtractionStrategy().extract(str(pdf))

    assert "Heading near top" in result.text


def test_pdf_extraction_drops_cross_page_repetition(tmp_path):
    pdf = tmp_path / "banner.pdf"
    _write_pdf(pdf, [
        [(MIDDLE_Y, "Unique intro"), (MIDDLE_Y + LINE_SPACING, "REPEATED BANNER")],
        [(MIDDLE_Y, "Unique findings"), (MIDDLE_Y + LINE_SPACING, "REPEATED BANNER")],
    ])

    result = PdfExtractionStrategy().extract(str(pdf))

    assert "REPEATED BANNER" not in result.text
    assert "Unique intro" in result.text
    assert "Unique findings" in result.text
