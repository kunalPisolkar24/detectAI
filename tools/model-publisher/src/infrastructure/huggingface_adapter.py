"""Backward-compat shim — prefer src.infrastructure.huggingface.registry."""

from src.infrastructure.huggingface.registry import HuggingFaceRegistry  # noqa: F401

__all__ = ["HuggingFaceRegistry"]
