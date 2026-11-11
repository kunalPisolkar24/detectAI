import asyncio
import logging
from collections.abc import Mapping
from pathlib import Path

from .config import ConfigFactory, Settings, deployment_flick
from .models import ModelArtifactManager, ModelSpecs
from .models.huggingface import HuggingFaceStore
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

    _ensure_model_artifacts(settings)

    await run_server(port=settings.grpc_port)


def _ensure_model_artifacts(settings: Settings) -> Mapping[str, Path]:
    """Pull before serving: a missing or unpullable artifact kills the boot."""
    store = HuggingFaceStore(root=Path(settings.model_cache_dir), token=settings.hf_token)
    return ModelArtifactManager(ModelSpecs.from_settings(settings), store).ensure_all()


if __name__ == "__main__":
    asyncio.run(main())
