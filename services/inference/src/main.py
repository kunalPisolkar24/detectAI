import asyncio
import concurrent.futures
import os
import sys

from prometheus_client import start_http_server
from src.infrastructure.tracing import setup_tracing, shutdown_tracing

from src.application.services.aggregation import ResultAggregator
from src.application.services.chunking import build_chunk_planner
from src.application.services.document_analysis import DocumentAnalysisService
from src.application.services.validation import InputValidator
from src.infrastructure.config import get_settings
from src.infrastructure.log_setup import configure_logger
from src.adapters.outbound.inference.loader import HuggingFaceLoader
from src.adapters.outbound.inference.engines.spark import SparkEngine
from src.adapters.outbound.inference.engines.flare import FlareEngine
from src.adapters.outbound.inference.batcher import BatchingProxy
from src.adapters.inbound.grpc.grpc_server import GRPCServer
from src.infrastructure.metrics import PrometheusTelemetryReporter
import structlog

configure_logger()
logger = structlog.get_logger()
settings = get_settings()


async def main():
    spark_executor: concurrent.futures.ThreadPoolExecutor | None = None
    flare_executor: concurrent.futures.ThreadPoolExecutor | None = None
    tracing_provider = None
    try:
        tracing_provider = setup_tracing(service_name=os.getenv("OTEL_SERVICE_NAME", "inference"))
        start_http_server(settings.METRICS_PORT)
        logger.info("metrics_server_started", port=settings.METRICS_PORT)

        # Per-model executors for isolation (slow flare cannot starve spark)
        workers = settings.INFERENCE_MAX_WORKERS
        spark_workers = max(4, workers // 2)
        flare_workers = max(4, workers - spark_workers)
        spark_executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=spark_workers,
            thread_name_prefix="spark-pool",
        )
        flare_executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=flare_workers,
            thread_name_prefix="flare-pool",
        )

        loader = HuggingFaceLoader(
            settings.MODEL_CACHE_DIR,
            settings.INFERENCE_PROVIDERS,
            settings.SPARK_MODEL_REVISION,
            settings.FLARE_MODEL_REVISION,
        )

        logger.info("loading_models")
        loop = asyncio.get_running_loop()
        spark_resources = await loop.run_in_executor(None, loader.load, "spark")
        flare_resources = await loop.run_in_executor(None, loader.load, "flare")

        spark_raw = SparkEngine(spark_resources)
        flare_raw = FlareEngine(flare_resources, max_length=settings.CHUNK_TOKEN_LIMIT)
        
        spark_batched = BatchingProxy(
            spark_raw,
            settings.BATCH_SIZE,
            settings.BATCH_TIMEOUT,
            "spark",
            settings.BATCH_QUEUE_MAX_SIZE,
            executor=spark_executor,
            max_concurrent_batches=settings.MAX_CONCURRENT_BATCHES,
        )
        flare_batched = BatchingProxy(
            flare_raw,
            settings.BATCH_SIZE,
            settings.BATCH_TIMEOUT,
            "flare",
            settings.BATCH_QUEUE_MAX_SIZE,
            executor=flare_executor,
            max_concurrent_batches=settings.MAX_CONCURRENT_BATCHES,
        )
        await spark_batched.start()
        await flare_batched.start()

        analysis_service = DocumentAnalysisService(
            engines={
                "spark": spark_batched,
                "flare": flare_batched,
            },
            health_reporters={
                "spark": spark_batched,
                "flare": flare_batched,
            },
            planners={
                "spark": build_chunk_planner(spark_resources[1], settings.CHUNK_TOKEN_LIMIT, settings.CHUNK_TOKEN_STRIDE, settings.MAX_GLOBAL_TOKENS),
                "flare": build_chunk_planner(flare_resources[1], settings.CHUNK_TOKEN_LIMIT, settings.CHUNK_TOKEN_STRIDE, settings.MAX_GLOBAL_TOKENS),
            },
            validator=InputValidator(settings.MAX_TEXT_CHARS),
            aggregator=ResultAggregator(settings.CHUNK_TOKEN_STRIDE),
            max_inflight_chunks=settings.MAX_INFLIGHT_DOC_CHUNKS,
            telemetry=PrometheusTelemetryReporter(),
        )
        
        server = GRPCServer(analysis_service)
        await server.start()

    except Exception as e:
        logger.critical("startup_failed", error=str(e), exc_info=True)
        sys.exit(1)
    finally:
        try:
            shutdown_tracing(tracing_provider)
        except Exception:
            pass
        for ex in (spark_executor, flare_executor):
            if ex is not None:
                ex.shutdown(wait=False, cancel_futures=True)

if __name__ == "__main__":
    asyncio.run(main())
