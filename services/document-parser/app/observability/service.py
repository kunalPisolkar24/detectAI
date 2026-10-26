"""The facade the route calls and the factory main.py drives — the package's
composition root and its single branch point.

One class, one lifecycle: the service owns the instruments, the in-flight
state, the three adapters, and the drain. Splitting a dedicated telemetry
implementation out of it adds an indirection hop on every recording call for
no caller it serves — the route calls it the way it calls the validation
service (observability.md's seam view). opentelemetry imports live inside
this package alone; the contract ships none of them.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from typing import TYPE_CHECKING

from ..config import Settings
from .contract import (
    ExtractionOutcome,
    NullObservability,
    Observability,
    RejectionReason,
)

if TYPE_CHECKING:
    # Typed only — the runtime wiring is the factory's, when the build lands.
    from fastapi import FastAPI

    from .adapters.logs import LogsAdapter
    from .adapters.metrics import MetricsAdapter
    from .adapters.traces import TracesAdapter

# The frozen instrument contract: these exact names keep the existing New
# Relic dashboards and terraform alerts working (observability.md's metric
# inventory). Renaming any of them is a contract migration, not a rename.
_INSTRUMENT_REJECTIONS = "rejected_uploads_total"        # Counter — reason
_INSTRUMENT_PARSED = "parsed_documents_total"            # Counter — mime_type, status
_INSTRUMENT_FAILURES = "extraction_failures_total"       # Counter — mime_type, error_type
_INSTRUMENT_TIMEOUTS = "extraction_timeouts_total"       # Counter — mime_type
_INSTRUMENT_DURATION = "extraction_duration_seconds"     # Histogram — mime_type, status
_INSTRUMENT_IN_FLIGHT = "in_flight_requests"             # ObservableGauge — no attributes


class _InFlight:
    """The gauge's state: a lock-guarded count, sampled at export time.

    Guarded not because the event loop races but because a thawing Lambda
    instance may not share a thread (observability.md's instrument view).
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._count = 0

    def begin(self) -> None:
        raise NotImplementedError(
            "TODO(observability build): guarded increment"
        )

    def end(self) -> None:
        raise NotImplementedError(
            "TODO(observability build): guarded decrement"
        )

    def value(self) -> int:
        """What the ObservableGauge's callback reads."""
        raise NotImplementedError(
            "TODO(observability build): guarded read-back"
        )


class ObservabilityService:
    """The wired realization of the seam: records and drains its own adapters.

    Instruments are built once from the adapters' own provider objects —
    traces.provider().get_tracer(...) and metrics.meter() — never read back
    from the opentelemetry module globals; that is what keeps the
    in-memory-exporter tests possible without the network.
    """

    def __init__(
        self,
        *,
        traces: TracesAdapter,
        metrics: MetricsAdapter,
        logs: LogsAdapter,
    ) -> None:
        self._traces = traces
        self._metrics = metrics
        self._logs = logs
        self._in_flight = _InFlight()
        # TODO(observability build): the tracer, the meter, and the six
        # instruments — built once here, from the adapters above.

    @contextmanager
    def track_request(self) -> Iterator[None]:
        """Brackets the whole handler — rejections included — and feeds
        in_flight_requests. Emits no span of its own: the FastAPI
        instrumentation already owns the request span."""
        raise NotImplementedError(
            "TODO(observability build): begin(), yield, end() in a finally"
        )

    @contextmanager
    def track_extraction(self, mime_type: str) -> Iterator[None]:
        """Carries the extraction span with the mime attribute under its
        span; a raise exits the bracket with the span still closed."""
        raise NotImplementedError(
            "TODO(observability build): start the span, yield, end it in a finally"
        )

    def record_rejection(self, reason: RejectionReason) -> None:
        """One add on rejected_uploads_total, reason attributed."""
        raise NotImplementedError(
            "TODO(observability build): add 1 with the reason attribute"
        )

    def record_extraction(
        self, mime_type: str, outcome: ExtractionOutcome, duration_seconds: float
    ) -> None:
        """One call per attempt; the service owns the fold so the route
        cannot record an inconsistent pair. A timeout is not also a failure,
        which is why dashboards can sum failures + timeouts without double
        counting (observability.md's verdict table).
        TODO(observability build): ok | truncated → parsed_documents_total +
        the duration histogram; timeout → extraction_timeouts_total +
        histogram; unreadable → extraction_failures_total
        (error_type="unreadable_document") + histogram."""
        raise NotImplementedError(
            "TODO(observability build): fold the outcome over the instruments"
        )

    def shutdown(self) -> None:
        """The drain: detach the log handler first, then flush spans →
        metrics → logs, per-adapter try/except, idempotent — three capped
        flushes fit the 12 s graceful drain the Dockerfile bounds."""
        raise NotImplementedError(
            "TODO(observability build): drain the adapters in signal order, each guarded"
        )


def build_observability_service(settings: Settings, app: FastAPI) -> Observability:
    """The NFR-5 gate: unset endpoint → nothing is emitted, nothing installed.

    The disabled build returns NullObservability — zero SDK objects — so dev
    is a silent no-op and the route keeps one code path with no `if endpoint`
    branches anywhere. An endpoint with a license key builds ready; whatever
    the factory cannot finish fails the boot, matching ConfigFactory.create
    and build_default_service — returned ready or the boot fails, never a
    half-built state between two phases.
    """
    # app is consumed only by the wired build (FastAPIInstrumentor takes it);
    # the disabled build installs nothing, so it is unused on this path.
    if settings.otel_exporter_otlp_endpoint is None:
        return NullObservability()
    raise NotImplementedError(
        "TODO(observability build): the wired build — resource once, the three "
        "adapters started once against it, FastAPIInstrumentor.instrument_app(app), "
        "then ObservabilityService holding them"
    )
