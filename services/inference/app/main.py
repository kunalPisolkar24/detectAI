import asyncio
import logging

from .config import ConfigFactory, Settings, deployment_flick
from .serving.server import run_server

# Stdout is the baseline level until the plane resolves; the seeded knob follows.
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main() -> None:
    # Fail the boot before serving: a bad plane or key dies here.
    flick = deployment_flick()
    provider = ConfigFactory.create(flick)
    settings = Settings.from_provider(provider)
    logging.getLogger().setLevel(settings.log_level)
    logger.info("config plane: %s", flick)

    await run_server(port=settings.grpc_port)


if __name__ == "__main__":
    asyncio.run(main())
