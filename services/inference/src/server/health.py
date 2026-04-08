import asyncio
from grpc_health.v1 import health
from grpc_health.v1 import health_pb2
from grpc_health.v1 import health_pb2_grpc
import structlog

logger = structlog.get_logger()

def add_health_check(server, analysis_service):
    health_servicer = health.aio.HealthServicer()
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)
    
    async def watchtower():
        while True:
            is_healthy = True
            for engine_name, engine in analysis_service.engines.items():
                if hasattr(engine, 'queue') and engine.queue.full():
                    is_healthy = False
                    break
            
            state = health_pb2.HealthCheckResponse.SERVING if is_healthy else health_pb2.HealthCheckResponse.NOT_SERVING
            await health_servicer.set("", state)
            await health_servicer.set("aidetection.AIService", state)
            
            if not is_healthy:
                logger.warning("health_probe_failed", reason="inference_queues_full")
                
            await asyncio.sleep(5)

    asyncio.create_task(watchtower())