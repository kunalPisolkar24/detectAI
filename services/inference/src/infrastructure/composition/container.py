import asyncio

from src.adapters.inbound.grpc.grpc_server import GRPCServer
from src.adapters.outbound.inference.batcher import BatchingProxy
from src.adapters.outbound.inference.engines.flare import FlareEngine
from src.adapters.outbound.inference.engines.spark import SparkEngine
from src.adapters.outbound.inference.loader import HuggingFaceLoader
from src.application.services.aggregation import ResultAggregator
from src.application.services.chunking import build_chunk_planner
from src.application.services.document_analysis import DocumentAnalysisService
from src.application.services.validation import InputValidator


async def build_analysis_service(settings, telemetry, executors):
    spark_ex, flare_ex = executors
    loader = HuggingFaceLoader(
        cache_dir=settings.MODEL_CACHE_DIR,
        providers=settings.INFERENCE_PROVIDERS,
        spark_model_revision=settings.SPARK_MODEL_REVISION,
        flare_model_revision=settings.FLARE_MODEL_REVISION,
        hf_token=settings.HF_TOKEN,
        telemetry=telemetry,
    )
    loop = asyncio.get_running_loop()
    spark_res = await loop.run_in_executor(None, loader.load, "spark")
    flare_res = await loop.run_in_executor(None, loader.load, "flare")

    spark_raw = SparkEngine(spark_res)
    flare_raw = FlareEngine(flare_res, max_length=settings.CHUNK_TOKEN_LIMIT)

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
