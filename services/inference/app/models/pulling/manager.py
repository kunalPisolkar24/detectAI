"""The pull orchestrator: probe every spec offline, pull the misses in parallel, fail fast."""

import logging
import threading
import time
from collections.abc import Mapping, Sequence
from pathlib import Path

from ..errors import MissingArtifact
from .spec import ModelSpec
from .store import ArtifactStore

logger = logging.getLogger(__name__)

# How often the abort checks for a sibling's failure while a pull is in flight.
_POLL_SECONDS = 0.1


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
        """One worker per missing model; the first failure aborts the boot.

        The workers are daemonic on purpose: an abort must not wait out a
        sibling's multi-gigabyte download before the process can exit. The
        abandoned download leaves an incomplete file the next boot re-fetches.
        """
        pulled: dict[str, Path] = {}
        failure: list[BaseException] = []
        aborted = threading.Event()
        lock = threading.Lock()

        def pull(spec: ModelSpec) -> None:
            try:
                path = self._store.pull(spec)
            except BaseException as error:  # noqa: BLE001 - a worker's failure aborts the boot
                with lock:
                    failure.append(error)
                aborted.set()
            else:
                with lock:
                    pulled[spec.key] = path

        workers = [
            threading.Thread(
                target=pull, args=(spec,), name=f"model-pull-{spec.key}", daemon=True
            )
            for spec in specs
        ]
        for worker in workers:
            worker.start()
        for worker in workers:
            while worker.is_alive() and not aborted.is_set():
                worker.join(timeout=_POLL_SECONDS)
        if failure:
            raise failure[0]
        return pulled
