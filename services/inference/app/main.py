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
from .serving.server import run_server

# Stdout is the baseline level until the plane resolves; the seeded knob follows.
logging.basicConfig(level=logging.INFO)


async def main() -> None:
    # Fail the boot before serving: a bad plane or key dies here.
    plane = resolve_plane()
    settings = resolve_settings()

    artifacts = ensure_model_artifacts(settings)
    loaded = load_models(settings, artifacts)
    runtimes = build_runtimes(settings, loaded)
    warm_runtimes(runtimes)

    analysis = DocumentAnalysis(runtimes, threshold=settings.ai_detection_threshold)
    try:
        await run_server(
            port=settings.grpc_port,
            api_key=settings.api_key,
            analysis=analysis,
            max_inflight_requests=settings.max_inflight_requests,
            enable_reflection=plane == "dev",
        )
    finally:
        close_runtimes(runtimes)


if __name__ == "__main__":
    asyncio.run(main())
