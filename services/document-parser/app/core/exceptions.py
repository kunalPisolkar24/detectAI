class DocumentParserError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)

class UnsupportedFileTypeError(DocumentParserError):
    def __init__(self, mime_type: str):
        super().__init__(f"Unsupported media type: {mime_type}", status_code=415)

class ExtractionError(DocumentParserError):
    def __init__(self, detail: str):
        super().__init__(f"Extraction failed: {detail}", status_code=422)

class FileTooLargeError(DocumentParserError):
    def __init__(self, size: int, limit: int):
        super().__init__(
            f"File size {size} exceeds limit of {limit / 1024 / 1024}MB",
            status_code=413
        )

class DocumentTooLargeError(DocumentParserError):
    def __init__(self, size: int, limit: int):
        super().__init__(
            f"Document content size {size} exceeds limit of {limit / 1024 / 1024}MB",
            status_code=413
        )

class ExtractionTimeoutError(DocumentParserError):
    def __init__(self, timeout_seconds: float):
        super().__init__(
            f"Document extraction timed out after {timeout_seconds} seconds",
            status_code=504
        )
