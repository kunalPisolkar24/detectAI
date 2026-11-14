"""The per-model runtime: the bundle a model_id resolves to, and its two executor pools."""

from concurrent.futures import Executor, ThreadPoolExecutor
from dataclasses import dataclass

from .engine import OnnxEngine
from .preprocessing import DocumentPreprocessor

# The engine pool's width is the serving slice's knob (MAX_CONCURRENT_BATCHES); two
# keeps a spare worker, because an in-flight run cannot be cancelled.
_ENGINE_POOL_WORKERS = 2


@dataclass(frozen=True)
class ModelRuntime:
    """One model's runtime: what a model_id resolves to."""

    key: str
    preprocessor: DocumentPreprocessor
    engine: OnnxEngine
    batch_size: int
    preparation_executor: Executor
    engine_executor: Executor


def build_runtime(
    key: str,
    preprocessor: DocumentPreprocessor,
    engine: OnnxEngine,
    batch_size: int,
) -> ModelRuntime:
    """One model's bundle: the preprocessor, the engine, and the two executor pools."""
    return ModelRuntime(
        key=key,
        preprocessor=preprocessor,
        engine=engine,
        batch_size=batch_size,
        preparation_executor=ThreadPoolExecutor(thread_name_prefix=f"{key}-preparation"),
        engine_executor=ThreadPoolExecutor(
            max_workers=_ENGINE_POOL_WORKERS, thread_name_prefix=f"{key}-engine"
        ),
    )
