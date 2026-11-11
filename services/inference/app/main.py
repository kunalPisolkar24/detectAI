import asyncio
import logging
import os

from .serving.server import run_server


async def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    await run_server(port=int(os.environ.get("GRPC_PORT", "50051")))


if __name__ == "__main__":
    asyncio.run(main())
