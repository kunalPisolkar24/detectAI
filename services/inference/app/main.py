import asyncio
import logging
import time
from collections.abc import Mapping
from pathlib import Path

from .config import ConfigFactory, Settings, deployment_flick
from .inference.engine import OnnxEngine
from .inference.preprocessing import DocumentPreprocessor, FastTokenizer
from .inference.runtime import ModelRuntime, build_runtime
from .models import LoadedModel, ModelArtifactManager, ModelSpecs
from .models.loading.onnx import OnnxModelLoader
from .models.pulling.huggingface import HuggingFaceStore
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

    artifacts = _ensure_model_artifacts(settings)
    loaded = _load_models(settings, artifacts)
    runtimes = _build_runtimes(settings, loaded)
    _warm_runtimes(runtimes)
    logger.info(
        "model runtimes: %s",
        ", ".join(
            f"{key} (batch {runtime.batch_size})"
            for key, runtime in sorted(runtimes.items())
        ),
    )

    await run_server(port=settings.grpc_port, api_key=settings.api_key)


def _ensure_model_artifacts(settings: Settings) -> Mapping[str, Path]:
    """Pull before serving: a missing or unpullable artifact kills the boot."""
    store = HuggingFaceStore(root=Path(settings.model_cache_dir), token=settings.hf_token)
    return ModelArtifactManager(ModelSpecs.from_settings(settings), store).ensure_all()


def _load_models(settings: Settings, artifacts: Mapping[str, Path]) -> Mapping[str, LoadedModel]:
    """Load after pull, before serving: a bad build kills the boot."""
    loader = OnnxModelLoader(
        providers=settings.inference_providers,
        intra_op_threads=settings.ort_intra_op_threads,
    )
    return loader.load_all(artifacts)


def _build_runtimes(
    settings: Settings, loaded: Mapping[str, LoadedModel]
) -> Mapping[str, ModelRuntime]:
    """Build after load, before serving: one runtime per model, walking sorted."""
    runtimes: dict[str, ModelRuntime] = {}
    for key, model in sorted(loaded.items()):
        tokenizer = FastTokenizer(model.tokenizer)
        batch_size = settings.batch_size_for(key)
        preprocessor = DocumentPreprocessor(
            tokenizer=tokenizer,
            chunk_token_limit=settings.chunk_token_limit,
            model_max_sequence_length=model.max_sequence_length,
            max_text_chars=settings.max_text_chars,
            chunk_token_overlap=settings.chunk_token_overlap,
        )
        engine = OnnxEngine(
            session=model.session,
            pad_token_id=tokenizer.pad_token_id,
            max_sequence_length=model.max_sequence_length,
            batch_size=batch_size,
        )
        runtimes[key] = build_runtime(
            key=key,
            preprocessor=preprocessor,
            engine=engine,
            batch_size=batch_size,
        )
    return runtimes


def _warm_runtimes(runtimes: Mapping[str, ModelRuntime]) -> None:
    """Warm after build, before serving: a model that cannot score kills the boot."""
    for key, runtime in sorted(runtimes.items()):
        started = time.perf_counter()
        runtime.engine.warmup(runtime.preprocessor.window_tokens)
        logger.info("%s: warmed up in %.1fs", key, time.perf_counter() - started)


if __name__ == "__main__":
    asyncio.run(main())
