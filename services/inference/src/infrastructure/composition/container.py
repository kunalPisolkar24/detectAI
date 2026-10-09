import asyncio

import structlog

from src.adapters.inbound.grpc.grpc_server import GRPCServer
from src.adapters.outbound.inference.batcher import BatchingProxy
from src.adapters.outbound.inference.engines.flare import FlareEngine
from src.adapters.outbound.inference.engines.spark import SparkEngine
from src.adapters.outbound.inference.loader import HuggingFaceLoader
from src.adapters.outbound.inference.loading.session_options import (
    build_session_options,
)
from src.application.services.aggregation import ResultAggregator
from src.application.services.chunking import build_chunk_planner
from src.application.services.document_analysis import DocumentAnalysisService
from src.application.services.validation import InputValidator

logger = structlog.get_logger()


async def build_analysis_service(settings, telemetry, executors):
    spark_ex, flare_ex = executors
    loader = HuggingFaceLoader(
        cache_dir=settings.MODEL_CACHE_DIR,
        providers=settings.INFERENCE_PROVIDERS,
        spark_model_revision=settings.SPARK_MODEL_REVISION,
        flare_model_revision=settings.FLARE_MODEL_REVISION,
        hf_token=settings.HF_TOKEN,
        telemetry=telemetry,
        session_options=build_session_options(
            intra_op_threads=settings.ORT_INTRA_OP_THREADS,
            inter_op_threads=settings.ORT_INTER_OP_THREADS,
            graph_opt_level=settings.ORT_GRAPH_OPT_LEVEL,
            execution_mode=settings.ORT_EXECUTION_MODE,
        ),
    )
    loop = asyncio.get_running_loop()
    spark_res, flare_res = await asyncio.gather(
        loop.run_in_executor(None, loader.load, "spark"),
        loop.run_in_executor(None, loader.load, "flare"),
    )

    spark_raw = SparkEngine(spark_res)
    flare_raw = FlareEngine(flare_res, max_length=settings.CHUNK_TOKEN_LIMIT)

    if settings.ORT_WARMUP_ENABLED:
        await asyncio.gather(
            loop.run_in_executor(spark_ex, _warmup_engine, spark_raw, "spark"),
            loop.run_in_executor(flare_ex, _warmup_engine, flare_raw, "flare"),
        )

    spark_batched = BatchingProxy(
        spark_raw,
        settings.BATCH_SIZE,
        settings.BATCH_TIMEOUT,
        "spark",
        settings.BATCH_QUEUE_MAX_SIZE,
        executor=spark_ex,
        max_concurrent_batches=settings.MAX_CONCURRENT_BATCHES,
        telemetry=telemetry,
    )
    flare_batched = BatchingProxy(
        flare_raw,
        settings.BATCH_SIZE,
        settings.BATCH_TIMEOUT,
        "flare",
        settings.BATCH_QUEUE_MAX_SIZE,
        executor=flare_ex,
        max_concurrent_batches=settings.MAX_CONCURRENT_BATCHES,
        telemetry=telemetry,
    )
    await spark_batched.start()
    await flare_batched.start()

    service = DocumentAnalysisService(
        engines={"spark": spark_batched, "flare": flare_batched},
        health_reporters={"spark": spark_batched, "flare": flare_batched},
        planners={
            "spark": build_chunk_planner(spark_res[1], settings.CHUNK_TOKEN_LIMIT, settings.CHUNK_TOKEN_STRIDE, settings.MAX_GLOBAL_TOKENS),
            "flare": build_chunk_planner(flare_res[1], settings.CHUNK_TOKEN_LIMIT, settings.CHUNK_TOKEN_STRIDE, settings.MAX_GLOBAL_TOKENS),
        },
        validator=InputValidator(settings.MAX_TEXT_CHARS),
        aggregator=ResultAggregator(settings.CHUNK_TOKEN_STRIDE),
        max_inflight_chunks=settings.MAX_INFLIGHT_DOC_CHUNKS,
        telemetry=telemetry,
    )
    return service, (spark_ex, flare_ex)


def build_server(analysis_service, settings, telemetry):
    return GRPCServer(analysis_service, config=settings, telemetry=telemetry)


def _warmup_engine(engine, model_key: str) -> None:
    try:
        engine.warmup()
    except Exception as e:  # noqa: BLE001 - warmup is best-effort and must not fail startup
        logger.warning("engine_warmup_failed", model=model_key, error=str(e))
