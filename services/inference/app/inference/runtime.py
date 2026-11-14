"""The per-model runtime: the bundle a model_id resolves to, and its two executor pools."""

from concurrent.futures import Executor, ThreadPoolExecutor
from dataclasses import dataclass

from .engine import Engine
from .preprocessing import DocumentPreprocessor

# The engine pool's width: how many documents one model may have in the engine
# at once. The serving slice's knob (MAX_INFLIGHT_DOCUMENTS) sets it, and the
# admission permit is the same width, so the pool never queues behind itself.
_ENGINE_POOL_WORKERS = 2


@dataclass(frozen=True)
class ModelRuntime:
    """One model's runtime: what a model_id resolves to."""

    key: str
    preprocessor: DocumentPreprocessor
    engine: Engine
    batch_size: int
    preparation_executor: Executor
    engine_executor: Executor
    max_inflight: int


def build_runtime(
    key: str,
    preprocessor: DocumentPreprocessor,
    engine: Engine,
    batch_size: int,
    max_inflight: int = _ENGINE_POOL_WORKERS,
) -> ModelRuntime:
    """One model's bundle: the preprocessor, the engine, and the two executor pools."""
    return ModelRuntime(
        key=key,
        preprocessor=preprocessor,
        engine=engine,
        batch_size=batch_size,
        preparation_executor=ThreadPoolExecutor(thread_name_prefix=f"{key}-preparation"),
        engine_executor=ThreadPoolExecutor(
            max_workers=max_inflight, thread_name_prefix=f"{key}-engine"
        ),
        max_inflight=max_inflight,
    )
