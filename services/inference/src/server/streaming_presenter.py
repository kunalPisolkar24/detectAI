from src.generated import ai_service_pb2
from src.inference.document_types import DocumentProgress, DocumentScore, DocumentStarted


class StreamingPresenter:
    def build_started(self, total_chars: int, total_chunks: int):
        return ai_service_pb2.AnalyzeDocumentEvent(
            started=ai_service_pb2.AnalyzeDocumentStarted(
                total_chars=total_chars,
                total_chunks=total_chunks,
            )
        )

    def build_progress(self, progress: DocumentProgress):
        return ai_service_pb2.AnalyzeDocumentEvent(
            progress=ai_service_pb2.AnalyzeDocumentProgress(
                processed_chunks=progress.processed_chunks,
                total_chunks=progress.total_chunks,
            )
        )

    def build_final(self, response):
        return ai_service_pb2.AnalyzeDocumentEvent(final=response)

    def is_progress(self, event) -> bool:
        return isinstance(event, DocumentProgress)

    def is_started(self, event) -> bool:
        return isinstance(event, DocumentStarted)

    def is_final(self, event) -> bool:
        return isinstance(event, DocumentScore)
