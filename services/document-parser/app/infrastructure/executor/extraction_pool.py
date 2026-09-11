import threading
from concurrent.futures import ThreadPoolExecutor

from app.infrastructure.observability.metrics import (
    EXTRACTION_POOL_ACTIVE_THREADS,
    EXTRACTION_POOL_MAX_WORKERS,
    EXTRACTION_POOL_QUEUE_DEPTH,
)

_pool: ThreadPoolExecutor | None = None
_lock = threading.Lock()
_pool_busy_tasks = 0
_busy = _pool_busy_tasks


def _snapshot() -> tuple[int, int, int] | None:
    if _pool is None:
        return None
    with _lock:
        busy = _pool_busy_tasks
    try:
        queued = _pool._work_queue.qsize()  # type: ignore[attr-defined]
    except Exception:
        queued = 0
    max_workers = getattr(_pool, "_max_workers", 0)
    return busy, queued, max_workers


def register_extraction_pool(pool: ThreadPoolExecutor | None) -> None:
    global _pool
    _pool = pool
    refresh_pool_gauges()


def mark_extraction_started() -> None:
    global _pool_busy_tasks, _busy
    with _lock:
        _pool_busy_tasks += 1
        _busy = _pool_busy_tasks


def mark_extraction_finished() -> None:
    global _pool_busy_tasks, _busy
    with _lock:
        _pool_busy_tasks -= 1
        _busy = _pool_busy_tasks


def get_pool_stats() -> tuple[int, int, int] | None:
    return _snapshot()


def refresh_pool_gauges() -> None:
    stats = _snapshot()
    if stats is None:
        return
    busy, queued, max_workers = stats
    EXTRACTION_POOL_ACTIVE_THREADS.set(busy)
    EXTRACTION_POOL_QUEUE_DEPTH.set(queued)
    EXTRACTION_POOL_MAX_WORKERS.set(max_workers)


def is_extraction_pool_healthy() -> bool:
    return _pool is not None and not getattr(_pool, "_shutdown", False)


register_process_pool = register_extraction_pool
get_pool_stats_alias = get_pool_stats
is_process_pool_healthy = is_extraction_pool_healthy
refresh_process_pool_gauges = refresh_pool_gauges
