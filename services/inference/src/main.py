import asyncio
from prometheus_client import start_http_server
from src.config import settings
from src.inference.aggregation import ResultAggregator
from src.inference.chunking import build_chunk_planner
from src.inference.document_analysis import DocumentAnalysisService
from src.inference.validation import InputValidator
from src.log_setup import configure_logger
from src.inference.loader import HuggingFaceLoader
from src.inference.engines.spark import SparkEngine
from src.inference.engines.flare import FlareEngine
from src.inference.batcher import BatchingProxy
from src.server.grpc_server import GRPCServer
import structlog

configure_logger()
logger = structlog.get_logger()

async def main():
    try:
        start_http_server(settings.METRICS_PORT)
        logger.info("metrics_server_started", port=settings.METRICS_PORT)
        
        loader = HuggingFaceLoader(
            settings.MODEL_CACHE_DIR,
            settings.INFERENCE_PROVIDERS,
            settings.SPARK_MODEL_REVISION,
            settings.FLARE_MODEL_REVISION,
        )
        
        logger.info("loading_models")
        spark_resources = loader.load("spark")
        flare_resources = loader.load("flare")

        spark_raw = SparkEngine(spark_resources)
        flare_raw = FlareEngine(flare_resources)
        
        spark_batched = BatchingProxy(
            spark_raw, 
            settings.BATCH_SIZE, 
            settings.BATCH_TIMEOUT, 
            "spark",
            settings.BATCH_QUEUE_MAX_SIZE,
        )
        flare_batched = BatchingProxy(
            flare_raw, 
            settings.BATCH_SIZE, 
            settings.BATCH_TIMEOUT, 
            "flare",
            settings.BATCH_QUEUE_MAX_SIZE,
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
        )
        
        server = GRPCServer(analysis_service)
        await server.start()
        
    except Exception as e:
        logger.critical("startup_failed", error=str(e))
        exit(1)

if __name__ == "__main__":
    asyncio.run(main())
