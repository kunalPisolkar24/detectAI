"""Core exceptions — single hierarchy for the publisher tool."""

from __future__ import annotations


class MLException(Exception):
    """Base for all publisher errors."""


class ConfigError(MLException):
    """Invalid or missing configuration."""


class ArtifactNotFoundException(MLException):
    """Local artifact directory missing or unreadable."""

    def __init__(self, message: str, *, path: str | None = None) -> None:
        super().__init__(message)
        self.path = path


class UploadFailedException(MLException):
    """HuggingFace upload failed."""

    def __init__(self, message: str, *, repo_id: str | None = None) -> None:
        super().__init__(message)
        self.repo_id = repo_id


class TagFailedException(MLException):
    """HuggingFace tag creation failed."""

    def __init__(self, message: str, *, repo_id: str | None = None, tag: str | None = None) -> None:
        super().__init__(message)
        self.repo_id = repo_id
        self.tag = tag


class GuardError(MLException):
    """Blocked by safety guard (e.g. missing --confirm, invalid version)."""
