import asyncio
import os
import sys

import structlog
from prometheus_client import start_http_server

from src.infrastructure.composition.container import build_analysis_service, build_server
from src.infrastructure.composition.executors import create_model_executors
from src.infrastructure.config import get_settings
from src.infrastructure.log_setup import configure_logger
from src.infrastructure.metrics import PrometheusTelemetryReporter
from src.infrastructure.tracing import setup_tracing, shutdown_tracing

logger = structlog.get_logger()


async def main() -> None:
    configure_logger()
    settings = get_settings()
    telemetry = PrometheusTelemetryReporter()
    executors = create_model_executors(settings.INFERENCE_MAX_WORKERS)
    tracing_provider = None
    try:
        tracing_provider = setup_tracing(service_name=os.getenv("OTEL_SERVICE_NAME", "inference"))
        start_http_server(settings.METRICS_PORT)
        logger.info("metrics_server_started", port=settings.METRICS_PORT)
        logger.info("loading_models")
        analysis_service, _ = await build_analysis_service(settings, telemetry, executors)
        server = build_server(analysis_service, settings, telemetry)
        await server.start()
    except Exception as e:
        logger.critical("startup_failed", error=str(e), exc_info=True)
        sys.exit(1)
    finally:
        try:
            shutdown_tracing(tracing_provider)
        except Exception:
            pass
        for ex in executors:
            try:
                ex.shutdown(wait=False, cancel_futures=True)
            except Exception:
                pass


if __name__ == "__main__":
    asyncio.run(main())
