"""The pull orchestrator: probe every spec offline, pull the misses in parallel, fail fast."""

import logging
import time
from collections.abc import Mapping, Sequence
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from pathlib import Path

from .errors import MissingArtifact
from .spec import ModelSpec
from .store import ArtifactStore

logger = logging.getLogger(__name__)


class ModelArtifactManager:
    def __init__(self, specs: Sequence[ModelSpec], store: ArtifactStore) -> None:
        self._specs = tuple(specs)
        self._store = store

    def ensure_all(self) -> Mapping[str, Path]:
        """Every spec resolved locally: cache hits skip, misses pull in parallel; a failure aborts."""
        started = time.perf_counter()
        logger.info("model artifacts: ensuring %s", ", ".join(spec.key for spec in self._specs))

        artifacts: dict[str, Path] = {}
        misses: list[ModelSpec] = []
        for spec in self._specs:
            try:
                artifacts[spec.key] = self._store.locate(spec)
            except MissingArtifact:
                misses.append(spec)

        if misses:
            artifacts.update(self._pull_in_parallel(misses))

        logger.info(
            "model artifacts: ready in %.1fs (%s)",
            time.perf_counter() - started,
            ", ".join(f"{key}={path}" for key, path in sorted(artifacts.items())),
        )
        return artifacts

    def _pull_in_parallel(self, specs: Sequence[ModelSpec]) -> Mapping[str, Path]:
        """One worker per missing model; the first failure cancels the rest and aborts the boot."""
        pool = ThreadPoolExecutor(max_workers=len(specs), thread_name_prefix="model-pull")
        try:
            futures: dict[Future[Path], ModelSpec] = {
                pool.submit(self._store.pull, spec): spec for spec in specs
            }
            pulled: dict[str, Path] = {}
            for future in as_completed(futures):
                spec = futures[future]
                pulled[spec.key] = future.result()
            return pulled
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
