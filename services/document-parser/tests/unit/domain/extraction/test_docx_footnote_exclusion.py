import zipfile

from app.domain.extraction.strategies import DocxExtractionStrategy

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
</Types>"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

DOCUMENT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
</Relationships>"""

DOCUMENT_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Body text</w:t></w:r></w:p>
    <w:p>
      <w:r><w:t>Page </w:t></w:r>
      <w:r><w:fldChar w:fldCharType="begin"/></w:r>
      <w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
      <w:r><w:fldChar w:fldCharType="separate"/></w:r>
      <w:r><w:t>7</w:t></w:r>
      <w:r><w:fldChar w:fldCharType="end"/></w:r>
      <w:r><w:tab/></w:r>
      <w:r><w:t>end</w:t></w:r>
    </w:p>
  </w:body>
</w:document>"""

FOOTNOTES_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:type="normal" w:id="1">
    <w:p><w:r><w:t>FOOTNOTE LEAK CANARY</w:t></w:r></w:p>
  </w:footnote>
</w:footnotes>"""


def _write_docx(path):
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("[Content_Types].xml", CONTENT_TYPES)
        zf.writestr("_rels/.rels", ROOT_RELS)
        zf.writestr("word/_rels/document.xml.rels", DOCUMENT_RELS)
        zf.writestr("word/document.xml", DOCUMENT_XML)
        zf.writestr("word/footnotes.xml", FOOTNOTES_XML)


def test_docx_extraction_excludes_footnote_content(tmp_path):
    docx_file = tmp_path / "with-footnotes.docx"
    _write_docx(docx_file)

    result = DocxExtractionStrategy().extract(str(docx_file))

    assert "FOOTNOTE LEAK CANARY" not in result.text
    assert "Body text" in result.text


def test_docx_extraction_resolves_fields_and_expands_tabs(tmp_path):
    docx_file = tmp_path / "with-fields.docx"
    _write_docx(docx_file)

    result = DocxExtractionStrategy().extract(str(docx_file))

    assert "Body text" in result.text
    assert "Page 7 end" in result.text
    assert "\t" not in result.text
    for control_char in ("\x13", "\x14", "\x15"):
        assert control_char not in result.text
