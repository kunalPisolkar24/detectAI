import math
from collections import Counter

import fitz

from app.application.ports.extractor import ExtractorPort
from app.core.config import settings
from app.domain.entities import ExtractionResult
from app.domain.exceptions import DocumentTooLargeError, ExtractionError

_TEXT_BLOCK = 0
_EPS = 1e-9


class PdfExtractor(ExtractorPort):
    def extract(self, file_path: str) -> ExtractionResult:
        page_texts: list[str] = []
        total = 0
        unreadable = 0
        try:
            with fitz.open(file_path) as doc:
                if doc.page_count > settings.MAX_PDF_PAGES:
                    raise DocumentTooLargeError(doc.page_count, settings.MAX_PDF_PAGES)
                for page in doc:
                    try:
                        txt = self._page_text(page)
                    except Exception:
                        unreadable += 1
                        continue
                    if not txt:
                        continue
                    page_texts.append(txt)
                    total += len(txt)
                    if total > settings.MAX_TEXT_LENGTH:
                        break
        except DocumentTooLargeError:
            raise
        except Exception as e:
            raise ExtractionError(f"PDF processing failed: {e}") from e

        if unreadable and not page_texts:
            raise ExtractionError(f"PDF processing failed: all {unreadable} pages unreadable")

        return ExtractionResult(text=self._drop_repeated(page_texts), truncated=bool(unreadable))

    @staticmethod
    def _page_text(page) -> str:
        blocks = page.get_text("blocks")
        kept = [
            b[4] for b in blocks if b[6] == _TEXT_BLOCK and not PdfExtractor._in_margin(b, page.rect.height)
        ]
        return "\n".join(kept)

    @staticmethod
    def _in_margin(block, h: float) -> bool:
        y0, y1 = block[1], block[3]
        return y1 <= settings.HEADER_FOOTER_MARGIN_PT or y0 >= h - settings.HEADER_FOOTER_MARGIN_PT

    @classmethod
    def _drop_repeated(cls, texts: list[str]) -> str:
        ratio = settings.HEADER_REPETITION_RATIO
        if len(texts) < 2 or ratio <= 0:
            return "\n".join(texts)
        occ: Counter[str] = Counter()
        pages: list[list[tuple[str, str]]] = []
        for t in texts:
            pairs = [(line, cls._norm(line)) for line in t.split("\n")]
            pages.append(pairs)
            occ.update({n for _, n in pairs if n})
        min_pages = math.ceil(ratio * len(pages) - _EPS)
        kept = [line for pl in pages for line, n in pl if not n or occ[n] < min_pages]
        return "\n".join(kept)

    @staticmethod
    def _norm(line: str) -> str:
        return " ".join(line.split())
