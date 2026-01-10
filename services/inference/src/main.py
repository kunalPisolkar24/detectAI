from src.config import settings
from src.log_setup import configure_logger
from src.inference.loader import HuggingFaceLoader
from src.inference.engines.spark import SparkEngine
from src.inference.engines.flare import FlareEngine
from src.inference.batcher import BatchingProxy
from src.server.grpc_server import GRPCServer
import structlog

configure_logger()
logger = structlog.get_logger()

def main():
    try:
        loader = HuggingFaceLoader(settings.MODEL_CACHE_DIR)
        
        logger.info("loading_models")
        spark_raw = SparkEngine(loader.load("spark"))
        flare_raw = FlareEngine(loader.load("flare"))
        
        spark_batched = BatchingProxy(
            spark_raw, 
            settings.BATCH_SIZE, 
            settings.BATCH_TIMEOUT, 
            "spark"
        )
        flare_batched = BatchingProxy(
            flare_raw, 
            settings.BATCH_SIZE, 
            settings.BATCH_TIMEOUT, 
            "flare"
        )
        
        server = GRPCServer(spark_batched, flare_batched)
        server.start()
        
    except Exception as e:
        logger.critical("startup_failed", error=str(e))
        exit(1)

if __name__ == "__main__":
    main()