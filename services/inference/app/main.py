"""The process entry point: resolve the plane, boot the models, serve the contract."""

import asyncio
import logging

from .boot import (
    build_runtimes,
    close_runtimes,
    ensure_model_artifacts,
    load_models,
    resolve_plane,
    resolve_settings,
    warm_runtimes,
)
from .inference.analysis import DocumentAnalysis
from .observability import build_observability_service
from .serving.server import run_server

# Stdout is the baseline level until the plane resolves; the seeded knob follows.
logging.basicConfig(level=logging.INFO)

logger = logging.getLogger(__name__)


async def main() -> None:
    # Fail the boot before serving: a bad plane or key dies here.
    plane = resolve_plane()
    settings = resolve_settings()

    # The gate flips on the endpoint: unset installs nothing, set wires the
    # OTel ride-along and the interceptor the gRPC server carries.
    wiring = build_observability_service(settings, plane)
    logger.info("observability: %s", type(wiring.observability).__name__)

    artifacts = ensure_model_artifacts(settings)
    loaded = load_models(settings, artifacts)
    runtimes = build_runtimes(settings, loaded)
    warm_runtimes(runtimes)

    analysis = DocumentAnalysis(
        runtimes,
        threshold=settings.ai_detection_threshold,
        observability=wiring.observability,
    )
    try:
        await run_server(
            port=settings.grpc_port,
            api_key=settings.api_key,
            analysis=analysis,
            max_inflight_requests=settings.max_inflight_requests,
            enable_reflection=plane == "dev",
            server_interceptor=wiring.server_interceptor,
            observability=wiring.observability,
        )
    finally:
        close_runtimes(runtimes)
        # The final log is queued before the drain so it rides the flush out.
        logger.info("inference shutdown complete")
        wiring.observability.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
